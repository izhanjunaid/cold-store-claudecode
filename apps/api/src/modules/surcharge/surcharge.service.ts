import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  SurchargeSuggestionsResponseType,
  SurchargeResponseType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { resolveFacilitySettings } from '../facility/facility.service';
import { computeSurcharge } from './surcharge-calc';
import { buildJE21LatePaymentSurcharge } from '../accounting/templates/je-21-late-payment-surcharge';
import type { JournalEntryService } from '../accounting/journal-entry.service';

interface SurchargeRecord {
  id: string;
  invoiceId: string;
  surchargeDate: Date;
  monthsCharged: number;
  baseOutstandingPkr: { toString(): string };
  ratePctPerMonth: { toString(): string };
  amountPkr: { toString(): string };
  journalEntryId: string | null;
  notes: string | null;
  createdAt: Date;
}

function formatRecord(r: SurchargeRecord): SurchargeResponseType {
  return {
    id: r.id,
    invoice_id: r.invoiceId,
    surcharge_date: r.surchargeDate.toISOString().slice(0, 10),
    months_charged: r.monthsCharged,
    base_outstanding_pkr: Number(r.baseOutstandingPkr),
    rate_pct_per_month: Number(r.ratePctPerMonth),
    amount_pkr: Number(r.amountPkr),
    journal_entry_id: r.journalEntryId,
    notes: r.notes,
    created_at: r.createdAt.toISOString(),
  };
}

export class SurchargeService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  private async loadRule(facilityId: string, db: Prisma.TransactionClient | PrismaClient) {
    const facility = await db.facility.findUnique({ where: { id: facilityId } });
    return resolveFacilitySettings(facility?.settings ?? null).late_payment_surcharge;
  }

  async listSuggestions(
    facilityId: string,
    asOfStr?: string,
  ): Promise<SurchargeSuggestionsResponseType> {
    const rule = await this.loadRule(facilityId, this.prisma);
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    asOf.setHours(0, 0, 0, 0);

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
        surcharges: { select: { monthsCharged: true } },
      },
    });

    const suggestions = [];
    for (const inv of invoices) {
      const monthsAlreadyCharged = inv.surcharges.reduce((s, r) => s + r.monthsCharged, 0);
      const c = computeSurcharge({
        rule,
        invoiceDate: inv.invoiceDate,
        asOf,
        totalPkr: Number(inv.totalPkr),
        amountPaidPkr: Number(inv.amountPaidPkr),
        monthsAlreadyCharged,
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

  async apply(
    facilityId: string,
    invoiceId: string,
    userId: string,
    notes?: string,
  ): Promise<SurchargeResponseType> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await this.loadRule(facilityId, tx);
      if (!rule.enabled) throw Errors.SURCHARGE_RULE_DISABLED();

      // Row-lock the invoice so concurrent applies serialize
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        invoiceId,
        facilityId,
      );
      if (!rows[0]) throw Errors.INVOICE_NOT_FOUND();

      const inv = await tx.invoice.findFirstOrThrow({
        where: { id: invoiceId, facilityId },
        include: {
          billingParty: { select: { id: true, name: true, partyType: true } },
          surcharges: { select: { monthsCharged: true } },
        },
      });
      if (inv.status !== 'FINALIZED') throw Errors.INVOICE_NOT_FINALIZED();

      const asOf = new Date();
      asOf.setHours(0, 0, 0, 0);
      const monthsAlreadyCharged = inv.surcharges.reduce((s, r) => s + r.monthsCharged, 0);
      const c = computeSurcharge({
        rule,
        invoiceDate: inv.invoiceDate,
        asOf,
        totalPkr: Number(inv.totalPkr),
        amountPaidPkr: Number(inv.amountPaidPkr),
        monthsAlreadyCharged,
      });

      if (c.chargeableMonths < 1 || c.suggestedPkr <= 0) {
        // Distinguish "already covered" from "never eligible" for clearer errors
        if (c.eligibleMonths > 0 && monthsAlreadyCharged >= c.eligibleMonths) {
          throw Errors.SURCHARGE_ALREADY_APPLIED();
        }
        throw Errors.SURCHARGE_NOT_ELIGIBLE();
      }

      const record = await tx.invoiceSurcharge.create({
        data: {
          facilityId,
          invoiceId,
          surchargeDate: asOf,
          monthsCharged: c.chargeableMonths,
          baseOutstandingPkr: c.principalPkr,
          ratePctPerMonth: rule.pct_per_month,
          amountPkr: c.suggestedPkr,
          notes: notes ?? null,
          createdBy: userId,
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { surchargeTotalPkr: { increment: c.suggestedPkr } },
      });

      const draft = buildJE21LatePaymentSurcharge({
        surchargeId: record.id,
        invoiceNumber: inv.invoiceNumber ?? inv.id.slice(0, 8),
        surchargeDate: asOf,
        amountPkr: c.suggestedPkr,
        bookType: inv.bookType as 'PACCI' | 'KATCHI',
        billingParty: {
          id: inv.billingParty.id,
          partyType: inv.billingParty.partyType,
          name: inv.billingParty.name,
        },
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      const linked = await tx.invoiceSurcharge.update({
        where: { id: record.id },
        data: { journalEntryId: posted.id },
      });

      return formatRecord(linked);
    });
  }

  async listByInvoice(facilityId: string, invoiceId: string): Promise<SurchargeResponseType[]> {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, facilityId },
      select: { id: true },
    });
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    const records = await this.prisma.invoiceSurcharge.findMany({
      where: { facilityId, invoiceId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(formatRecord);
  }
}
