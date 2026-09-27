import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  SurchargeSuggestionsResponseType,
  SurchargeApplyResponseType,
  InvoiceSurchargesResponseType,
  AppliedSurchargeType,
} from '@coldchain/shared';
import { round2, toIsoDate } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { resolveFacilitySettings } from '../facility/facility.service';
import { computeSurcharge } from './surcharge-calc';
import { buildJE21SurchargeInvoice } from '../accounting/templates/je-21-late-payment-surcharge';
import { postedEntryNumber, type JournalEntryService } from '../accounting/journal-entry.service';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';
import { generateInvoiceNumber } from '../invoice/invoice-number';

type Db = Prisma.TransactionClient | PrismaClient;

/** Entries an older version posted straight to AR, sourced to the overdue invoice. */
const LEGACY_SOURCE = 'invoice_surcharge';

/**
 * Late-payment surcharge (docs/25 R-08). Each application bills the chargeable
 * months as a SURCHARGE invoice of its own — pointing at the overdue invoice
 * through surcharge_of_invoice_id — so it is allocated, credited, written off and
 * voided like any invoice. Months already charged = months on the overdue
 * invoice's standing surcharge invoices, plus the legacy JE-21s an older version
 * posted one per month; re-applying within the same 30-day block charges nothing.
 */
export class SurchargeService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  private async loadRule(facilityId: string, db: Db) {
    const facility = await db.facility.findUnique({ where: { id: facilityId } });
    return resolveFacilitySettings(facility?.settings ?? null).late_payment_surcharge;
  }

  /** Months already charged on each overdue invoice. */
  private async monthsCharged(db: Db, facilityId: string, invoiceIds: string[]): Promise<Map<string, number>> {
    const [legacy, lines] = await Promise.all([
      db.journalEntry.groupBy({
        by: ['sourceId'],
        where: {
          facilityId,
          sourceTable: LEGACY_SOURCE,
          sourceId: { in: invoiceIds },
          postingStatus: 'POSTED',
          reversedById: null,
          entryType: { not: 'REVERSAL' },
        },
        _count: { _all: true },
      }),
      db.invoiceLineItem.findMany({
        where: {
          lineType: 'SURCHARGE',
          invoice: { facilityId, surchargeOfInvoiceId: { in: invoiceIds }, status: { not: 'VOID' } },
        },
        select: { quantity: true, invoice: { select: { surchargeOfInvoiceId: true } } },
      }),
    ]);
    const months = new Map<string, number>(legacy.map((l) => [l.sourceId, l._count._all]));
    for (const l of lines) {
      const of = l.invoice.surchargeOfInvoiceId!;
      months.set(of, (months.get(of) ?? 0) + Number(l.quantity));
    }
    return months;
  }

  async listSuggestions(facilityId: string, asOfStr?: string): Promise<SurchargeSuggestionsResponseType> {
    const rule = await this.loadRule(facilityId, this.prisma);
    const asOf = new Date(`${asOfStr ?? toIsoDate(new Date())}T00:00:00.000Z`);
    const base = {
      enabled: rule.enabled,
      pct_per_month: rule.pct_per_month,
      grace_days: rule.grace_days,
      as_of: toIsoDate(asOf),
    };
    if (!rule.enabled) return { ...base, suggestions: [] };

    // A surcharge is never charged on a surcharge.
    const invoices = await this.prisma.invoice.findMany({
      where: { facilityId, status: 'FINALIZED', surchargeOfInvoiceId: null },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalPkr: true,
        amountPaidPkr: true,
        billingParty: { select: { id: true, name: true } },
      },
    });
    const charged = await this.monthsCharged(this.prisma, facilityId, invoices.map((i) => i.id));

    const suggestions = [];
    for (const inv of invoices) {
      const c = computeSurcharge({
        rule,
        invoiceDate: inv.invoiceDate,
        asOf,
        totalPkr: Number(inv.totalPkr),
        amountPaidPkr: Number(inv.amountPaidPkr),
        monthsAlreadyCharged: charged.get(inv.id) ?? 0,
      });
      if (c.chargeableMonths < 1 || c.suggestedPkr <= 0) continue;
      suggestions.push({
        invoice_id: inv.id,
        invoice_number: inv.invoiceNumber,
        billing_party_id: inv.billingParty.id,
        billing_party_name: inv.billingParty.name,
        invoice_date: toIsoDate(inv.invoiceDate),
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
    return this.prisma.$transaction(async (tx) => {
      const rule = await this.loadRule(facilityId, tx);
      if (!rule.enabled) throw Errors.SURCHARGE_RULE_DISABLED();

      if (!(await lockRow(tx, 'invoices', invoiceId, facilityId))) throw Errors.INVOICE_NOT_FOUND();
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { billingParty: { select: RECEIVABLE_PARTY_SELECT } },
      });
      if (inv.status !== 'FINALIZED' || inv.surchargeOfInvoiceId) throw Errors.SURCHARGE_NOT_ELIGIBLE();

      const asOf = new Date(`${asOfStr ?? toIsoDate(new Date())}T00:00:00.000Z`);
      const alreadyCharged = (await this.monthsCharged(tx, facilityId, [invoiceId])).get(invoiceId) ?? 0;
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

      const perMonth = round2(c.principalPkr * (rule.pct_per_month / 100));
      const amount = round2(perMonth * c.chargeableMonths);
      const number = await generateInvoiceNumber(tx, facilityId, asOf);
      const surcharge = await tx.invoice.create({
        data: {
          facilityId,
          invoiceNumber: number,
          lotId: inv.lotId,
          billingPartyId: inv.billingPartyId,
          invoiceDate: asOf,
          periodStart: asOf,
          periodEnd: asOf,
          subTotalPkr: amount,
          gstRate: 0,
          gstAmountPkr: 0,
          totalPkr: amount,
          amountPaidPkr: 0,
          status: 'FINALIZED',
          finalizedAt: new Date(),
          finalizedBy: userId,
          bookType: inv.bookType,
          createdBy: userId,
          surchargeOfInvoiceId: inv.id,
          lineItems: {
            create: {
              lineType: 'SURCHARGE',
              description: `Late payment surcharge on ${inv.invoiceNumber}: months ${alreadyCharged + 1}–${alreadyCharged + c.chargeableMonths} at ${rule.pct_per_month}%`,
              quantity: c.chargeableMonths,
              unitPricePkr: perMonth,
              amountPkr: amount,
            },
          },
        },
      });
      const je = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE21SurchargeInvoice({
          invoiceId: surcharge.id,
          invoiceNumber: number,
          invoiceDate: asOf,
          amountPkr: amount,
          chargedOnInvoiceNumber: inv.invoiceNumber ?? inv.id,
          bookType: inv.bookType,
          billingParty: receivableParty(inv.billingParty),
          lotId: inv.lotId,
        }),
      );
      await tx.invoice.update({ where: { id: surcharge.id }, data: { journalEntryId: je.id } });

      return {
        invoice_id: invoiceId,
        months_charged: c.chargeableMonths,
        amount_pkr: amount,
        surcharge_invoice_id: surcharge.id,
        surcharge_invoice_number: number,
      };
    });
  }

  async listByInvoice(facilityId: string, invoiceId: string): Promise<InvoiceSurchargesResponseType> {
    const [invoices, legacy] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { facilityId, surchargeOfInvoiceId: invoiceId },
        orderBy: { invoiceDate: 'asc' },
        include: { lineItems: true, journalEntry: { select: { entryNumber: true } } },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          facilityId,
          sourceTable: LEGACY_SOURCE,
          sourceId: invoiceId,
          postingStatus: 'POSTED',
          entryType: { not: 'REVERSAL' },
        },
        orderBy: { entryDate: 'asc' },
        include: { lines: { where: { creditAmount: { gt: 0 } }, select: { creditAmount: true } } },
      }),
    ]);
    const surcharges: AppliedSurchargeType[] = [
      ...invoices.map((s) => ({
        invoice_id: s.id,
        invoice_number: s.invoiceNumber,
        journal_entry_id: s.journalEntryId,
        entry_number: s.journalEntry?.entryNumber ?? null,
        entry_date: toIsoDate(s.invoiceDate),
        months: s.lineItems.reduce((n, l) => n + Number(l.quantity), 0),
        amount_pkr: Number(s.totalPkr),
        status: s.status,
        description: s.lineItems[0]?.description ?? 'Late payment surcharge',
      })),
      ...legacy.map((e) => ({
        invoice_id: null,
        invoice_number: null,
        journal_entry_id: e.id,
        entry_number: postedEntryNumber(e),
        entry_date: toIsoDate(e.entryDate),
        months: 1,
        amount_pkr: round2(e.lines.reduce((s, l) => s + Number(l.creditAmount), 0)),
        status: 'LEGACY' as const,
        description: e.description,
      })),
    ];
    return {
      invoice_id: invoiceId,
      total_pkr: round2(surcharges.filter((s) => s.status !== 'VOID').reduce((s, r) => s + r.amount_pkr, 0)),
      surcharges,
    };
  }
}
