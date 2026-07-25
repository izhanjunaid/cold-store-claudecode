import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  SurchargeSuggestionsResponseType,
  SurchargeApplyResponseType,
  InvoiceSurchargesResponseType,
  AppliedSurchargeType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { resolveFacilitySettings } from '../facility/facility.service';
import { computeSurcharge } from './surcharge-calc';
import { buildJE21LatePaymentSurcharge } from '../accounting/templates/je-21-late-payment-surcharge';
import type { JournalEntryService } from '../accounting/journal-entry.service';

const SURCHARGE_SOURCE = 'invoice_surcharge';

/**
 * Late-payment surcharge, migration-free (phase/19): the GL is the system of
 * record. Each chargeable month posts one JE-21, keyed sourceTable/sourceId to
 * the invoice, so the posted count IS the months-already-charged tally and a
 * re-apply inside the same 30-day block charges nothing (idempotent).
 */
export class SurchargeService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  private async loadRule(facilityId: string, db: Prisma.TransactionClient | PrismaClient) {
    const facility = await db.facility.findUnique({ where: { id: facilityId } });
    return resolveFacilitySettings(facility?.settings ?? null).late_payment_surcharge;
  }

  /** Count of POSTED surcharge JEs for an invoice = months already charged. */
  private async monthsCharged(db: Prisma.TransactionClient | PrismaClient, facilityId: string, invoiceId: string) {
    return db.journalEntry.count({
      where: { facilityId, sourceTable: SURCHARGE_SOURCE, sourceId: invoiceId, postingStatus: 'POSTED' },
    });
  }

  async listSuggestions(facilityId: string, asOfStr?: string): Promise<SurchargeSuggestionsResponseType> {
    const rule = await this.loadRule(facilityId, this.prisma);
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setUTCHours(0, 0, 0, 0);

    const base = {
      enabled: rule.enabled,
      pct_per_month: rule.pct_per_month,
      grace_days: rule.grace_days,
      as_of: asOf.toISOString().slice(0, 10),
    };
    if (!rule.enabled) return { ...base, suggestions: [] };

    const invoices = await this.prisma.invoice.findMany({
      where: { facilityId, status: 'FINALIZED' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalPkr: true,
        amountPaidPkr: true,
        billingParty: { select: { id: true, name: true } },
      },
    });

    // Months already charged per invoice, from the GL.
    const charged = await this.prisma.journalEntry.groupBy({
      by: ['sourceId'],
      where: {
        facilityId,
        sourceTable: SURCHARGE_SOURCE,
        postingStatus: 'POSTED',
        sourceId: { in: invoices.map((i) => i.id) },
      },
      _count: { _all: true },
    });
    const chargedMap = new Map(charged.map((c) => [c.sourceId as string, c._count._all]));

    const suggestions = [];
    for (const inv of invoices) {
      const c = computeSurcharge({
        rule,
        invoiceDate: inv.invoiceDate,
        asOf,
        totalPkr: Number(inv.totalPkr),
        amountPaidPkr: Number(inv.amountPaidPkr),
        monthsAlreadyCharged: chargedMap.get(inv.id) ?? 0,
      });
      if (c.chargeableMonths < 1 || c.suggestedPkr <= 0) continue;
      suggestions.push({
        invoice_id: inv.id,
        invoice_number: inv.invoiceNumber,
        billing_party_id: inv.billingParty.id,
        billing_party_name: inv.billingParty.name,
        invoice_date: inv.invoiceDate.toISOString().slice(0, 10),
        days_overdue: c.daysOverdue,
        chargeable_months: c.chargeableMonths,
        base_outstanding_pkr: c.principalPkr,
        rate_pct_per_month: rule.pct_per_month,
        suggested_amount_pkr: c.suggestedPkr,
      });
    }
    suggestions.sort((a, b) => b.days_overdue - a.days_overdue);
    return { ...base, suggestions };
  }

  async apply(facilityId: string, invoiceId: string, userId: string, asOfStr?: string): Promise<SurchargeApplyResponseType> {
    const posted: AppliedSurchargeType[] = [];
    let monthsCharged = 0;
    let totalAmount = 0;

    await this.prisma.$transaction(async (tx) => {
      const rule = await this.loadRule(facilityId, tx);
      if (!rule.enabled) throw Errors.SURCHARGE_RULE_DISABLED();

      await tx.$queryRawUnsafe(
        `SELECT id FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        invoiceId,
        facilityId,
      );
      const inv = await tx.invoice.findFirst({
        where: { id: invoiceId, facilityId },
        include: { billingParty: { select: { id: true, name: true, partyType: true } } },
      });
      if (!inv) throw Errors.INVOICE_NOT_FOUND();
      if (inv.status !== 'FINALIZED') throw Errors.SURCHARGE_NOT_ELIGIBLE();

      const asOf = asOfStr ? new Date(asOfStr) : new Date();
      asOf.setUTCHours(0, 0, 0, 0);
      const alreadyCharged = await this.monthsCharged(tx, facilityId, invoiceId);

      const c = computeSurcharge({
        rule,
        invoiceDate: inv.invoiceDate,
        asOf,
        totalPkr: Number(inv.totalPkr),
        amountPaidPkr: Number(inv.amountPaidPkr),
        monthsAlreadyCharged: alreadyCharged,
      });
      if (c.eligibleMonths < 1 || c.principalPkr <= 0.005) throw Errors.SURCHARGE_NOT_ELIGIBLE();
      if (c.chargeableMonths < 1) throw Errors.SURCHARGE_ALREADY_APPLIED();

      // One JE per chargeable month so the posted count stays the source of
      // truth for months-charged; each month bills principal * rate.
      const perMonth = Math.round(c.principalPkr * (rule.pct_per_month / 100) * 100) / 100;
      for (let m = 1; m <= c.chargeableMonths; m++) {
        const draft = buildJE21LatePaymentSurcharge({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber ?? inv.id,
          surchargeDate: asOf,
          amountPkr: perMonth,
          monthIndex: alreadyCharged + m,
          bookType: inv.bookType as 'PACCI' | 'KATCHI',
          billingParty: { id: inv.billingParty.id, partyType: inv.billingParty.partyType, name: inv.billingParty.name },
        });
        const je = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, { postingStatus: 'POSTED' });
        posted.push({
          journal_entry_id: je.id,
          entry_number: je.entryNumber,
          entry_date: asOf.toISOString().slice(0, 10),
          amount_pkr: perMonth,
          description: draft.description,
        });
        totalAmount += perMonth;
      }
      monthsCharged = c.chargeableMonths;
    });

    return {
      invoice_id: invoiceId,
      months_charged: monthsCharged,
      amount_pkr: Math.round(totalAmount * 100) / 100,
      surcharges: posted,
    };
  }

  async listByInvoice(facilityId: string, invoiceId: string): Promise<InvoiceSurchargesResponseType> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { facilityId, sourceTable: SURCHARGE_SOURCE, sourceId: invoiceId, postingStatus: 'POSTED' },
      orderBy: { entryDate: 'asc' },
      include: { lines: { where: { creditAmount: { gt: 0 } }, select: { creditAmount: true } } },
    });
    const surcharges: AppliedSurchargeType[] = entries.map((e) => ({
      journal_entry_id: e.id,
      entry_number: e.entryNumber,
      entry_date: e.entryDate.toISOString().slice(0, 10),
      amount_pkr: e.lines.reduce((s, l) => s + Number(l.creditAmount), 0),
      description: e.description,
    }));
    return {
      invoice_id: invoiceId,
      total_pkr: Math.round(surcharges.reduce((s, r) => s + r.amount_pkr, 0) * 100) / 100,
      surcharges,
    };
  }
}
