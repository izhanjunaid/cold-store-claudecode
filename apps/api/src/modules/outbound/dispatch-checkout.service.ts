import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  addDays,
  businessDate,
  businessDayStart,
  round2,
  type DispatchAndCollectRequestType,
  type OutboundListQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { previewInvoiceFromOutbound } from '../invoice/invoice.builder';
import type { InvoiceService } from '../invoice/invoice.service';
import type { PaymentService } from '../payment/payment.service';
import type { OutboundService } from './outbound.service';

const OUTBOUND_STATUSES = ['PENDING', 'WEIGHED', 'DISPATCHED', 'CANCELLED', 'DISPUTED'] as const;

/** Where a withdrawal stands, in the order the desk shows it. */
export type DispatchStage = 'BOOKED' | 'WEIGHED' | 'DISPATCHED' | 'PAID' | 'LEFT' | 'CANCELLED';

const PAID_TOLERANCE = 0.01;

function stageOf(o: {
  status: string;
  gatePassId: string | null;
  invoice: { status: string; totalPkr: unknown; amountPaidPkr: unknown } | null;
}): DispatchStage {
  if (o.status === 'CANCELLED') return 'CANCELLED';
  if (o.status === 'PENDING' || o.status === 'DISPUTED') return 'BOOKED';
  if (o.status === 'WEIGHED') return 'WEIGHED';
  if (o.gatePassId) return 'LEFT';
  const inv = o.invoice;
  if (inv && inv.status === 'FINALIZED' && Number(inv.totalPkr) - Number(inv.amountPaidPkr) <= PAID_TOLERANCE) {
    return 'PAID';
  }
  return 'DISPATCHED';
}

/** A tonne is 1000 kg; quantities on a bill carry three decimals. */
const tonnes = (kg: number) => Math.round((kg / 1000) * 1000) / 1000;

/** The caller, as the checkout needs to know them: identity plus the keys they hold. */
export interface CheckoutCaller {
  facilityId: string;
  userId: string;
  role: string;
  permissions: Set<string>;
}

/**
 * The dispatch desk's reads and its one write: dispatch a weighed withdrawal, finalize
 * its bill and take the money in a single transaction (fast-dispatch Phase B). Every
 * step is the existing service's own `…InTransaction` — the checkout composes them,
 * it does not re-implement them, so each keeps its own locks, guards and posting path.
 */
export class DispatchCheckoutService {
  constructor(
    private prisma: PrismaClient,
    private outbound: OutboundService,
    private invoices: InvoiceService,
    private payments: PaymentService,
  ) {}

  /** The queue: withdrawals with the stage they have reached and what is billed on them. */
  async list(facilityId: string, query: OutboundListQueryType) {
    const where: Prisma.OutboundEventWhereInput = { facilityId };

    if (query.status) {
      const wanted = query.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const bad = wanted.filter((s) => !(OUTBOUND_STATUSES as readonly string[]).includes(s));
      if (bad.length > 0) throw Errors.VALIDATION_ERROR(`Unknown status: ${bad.join(', ')}`, 'status');
      where.status = { in: wanted as (typeof OUTBOUND_STATUSES)[number][] };
    }
    // Business days: "today" includes trucks booked between midnight and 05:00 in Lahore.
    if (query.date_from || query.date_to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.date_from) range.gte = businessDayStart(query.date_from);
      if (query.date_to) range.lt = businessDayStart(addDays(query.date_to, 1));
      where.AND = [{ OR: [{ createdAt: range }, { finalizedAt: range }] }];
    }
    if (query.search) {
      const q = query.search;
      where.OR = [
        { dispatchNoteNumber: { contains: q, mode: 'insensitive' } },
        { vehicleNumber: { contains: q, mode: 'insensitive' } },
        { lot: { lotNumber: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.outboundEvent.findMany({
        where,
        include: {
          lot: { select: { lotNumber: true, marka: true } },
          ownerPartySnapshot: { select: { name: true } },
          createdByUser: { select: { name: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true, totalPkr: true, amountPaidPkr: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.outboundEvent.count({ where }),
    ]);

    return {
      data: rows.map((o) => ({
        id: o.id,
        dispatch_note_number: o.dispatchNoteNumber,
        status: o.status,
        stage: stageOf(o),
        lot_id: o.lotId,
        lot_number: o.lot.lotNumber,
        marka: o.lot.marka,
        owner_party_name: o.ownerPartySnapshot?.name ?? null,
        withdrawal_type: o.withdrawalType,
        quantity_withdrawn_bags: o.quantityWithdrawnBags,
        outbound_weight_kg: o.outboundWeightKg == null ? null : Number(o.outboundWeightKg),
        outbound_date: o.outboundDate.toISOString().slice(0, 10),
        vehicle_number: o.vehicleNumber,
        created_at: o.createdAt.toISOString(),
        created_by_name: o.createdByUser.name,
        finalized_at: o.finalizedAt ? o.finalizedAt.toISOString() : null,
        gate_pass_id: o.gatePassId,
        invoice: o.invoice && {
          id: o.invoice.id,
          invoice_number: o.invoice.invoiceNumber,
          status: o.invoice.status,
          total_pkr: Number(o.invoice.totalPkr),
          balance_due_pkr: round2(Number(o.invoice.totalPkr) - Number(o.invoice.amountPaidPkr)),
        },
      })),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }

  /** The bill a weighed withdrawal will carry, before anything is written. */
  async preview(facilityId: string, id: string) {
    const ob = await this.prisma.outboundEvent.findFirst({
      where: { id, facilityId },
      include: { lot: { select: { lotNumber: true, billingParty: { select: { id: true, name: true } } } } },
    });
    if (!ob) throw Errors.OUTBOUND_NOT_FOUND();
    if (ob.status === 'DISPATCHED') throw Errors.OUTBOUND_ALREADY_FINALIZED();
    if (ob.status === 'CANCELLED') throw Errors.OUTBOUND_CANCELLED();
    if (ob.status !== 'WEIGHED') throw Errors.OUTBOUND_WEIGHT_REQUIRED();

    const priced = await previewInvoiceFromOutbound(this.prisma as unknown as Prisma.TransactionClient, id);
    const defaults = await this.defaultServiceLines(this.prisma as unknown as Prisma.TransactionClient, facilityId, {
      bags: ob.quantityWithdrawnBags,
      weightKg: ob.outboundWeightKg == null ? null : Number(ob.outboundWeightKg),
    });
    const serviceTotal = round2(defaults.reduce((s, l) => s + l.amountPkr, 0));
    const subTotal = round2(priced.subTotal + serviceTotal);
    // The same arithmetic InvoiceRepository.recomputeTotals applies to the built bill.
    const gstAmount = round2(subTotal * (priced.gstRate / 100));

    return {
      outbound_id: id,
      dispatch_note_number: ob.dispatchNoteNumber,
      lot_number: ob.lot.lotNumber,
      billing_party: ob.lot.billingParty,
      book_type: priced.params.bookType,
      quantity_withdrawn_bags: ob.quantityWithdrawnBags,
      outbound_weight_kg: ob.outboundWeightKg == null ? null : Number(ob.outboundWeightKg),
      period_start: priced.params.periodStart.toISOString().slice(0, 10),
      period_end: priced.params.periodEnd.toISOString().slice(0, 10),
      storage_line: {
        description: priced.charge.description,
        quantity: priced.charge.quantity,
        unit_price_pkr: priced.charge.unitPricePkr,
        amount_pkr: priced.charge.amountPkr,
        days: priced.charge.days,
      },
      service_lines: defaults.map((l) => ({
        service_charge_id: l.serviceChargeId,
        description: l.description,
        quantity: l.quantity,
        unit_price_pkr: l.unitPricePkr,
        amount_pkr: l.amountPkr,
      })),
      sub_total_pkr: subTotal,
      gst_rate: priced.gstRate,
      gst_amount_pkr: gstAmount,
      total_pkr: round2(subTotal + gstAmount),
    };
  }

  /**
   * Dispatch, bill and collect — or fail whole. Order inside the transaction: the
   * withdrawal and its lot lock and move (finalize), the bill gets its default service
   * lines, the total is checked against what the client reviewed, the bill is finalized
   * (JE-01), and the money is recorded against it (JE-02). A refusal at any step leaves
   * no trace of the earlier ones.
   */
  async dispatchAndCollect(caller: CheckoutCaller, id: string, body: DispatchAndCollectRequestType) {
    this.assertPermissions(caller, body);

    // Two checkouts racing for the numbering locks can deadlock; the loser is safe to rerun.
    for (let attempt = 0; ; attempt++) {
      try {
        // The checkout does many steps (dispatch, bill, two journal entries): more than Prisma's 5 s default.
        return await this.prisma.$transaction((tx) => this.run(tx, caller, id, body), { timeout: 30_000, maxWait: 10_000 });
      } catch (e) {
        if (attempt < 1 && isDeadlock(e)) continue;
        throw e;
      }
    }
  }

  /** Every key the steps need, checked before any write so a refusal names the missing one. */
  private assertPermissions(caller: CheckoutCaller, body: DispatchAndCollectRequestType) {
    const need = ['outbound.finalize', 'invoices.manage'];
    if (body.payment.mode !== 'CREDIT') need.push('payments.record');
    for (const key of need) {
      if (!caller.permissions.has(key)) throw Errors.FORBIDDEN(`Missing permission: ${key}`);
    }
  }

  private async run(tx: Prisma.TransactionClient, caller: CheckoutCaller, id: string, body: DispatchAndCollectRequestType) {
    const { facilityId, userId, role } = caller;

    const { outbound, invoiceId } = await this.outbound.finalizeInTransaction(
      tx,
      facilityId,
      id,
      body.notes,
      body.picked_from?.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
      userId,
    );

    const ob = await tx.outboundEvent.findUniqueOrThrow({
      where: { id },
      select: { quantityWithdrawnBags: true, outboundWeightKg: true },
    });
    const skip = new Set(body.skip_service_charge_ids ?? []);
    const lines = (
      await this.defaultServiceLines(tx, facilityId, {
        bags: ob.quantityWithdrawnBags,
        weightKg: ob.outboundWeightKg == null ? null : Number(ob.outboundWeightKg),
      })
    ).filter((l) => !skip.has(l.serviceChargeId));
    const total =
      lines.length > 0
        ? await this.invoices.addServiceLinesInTransaction(tx, invoiceId, lines)
        : Number((await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPkr: true } })).totalPkr);

    // What was reviewed is what posts.
    if (Math.abs(total - body.expected_total_pkr) > 0.005) {
      throw Errors.DISPATCH_TOTAL_CHANGED(body.expected_total_pkr, total);
    }

    const invoice = await this.invoices.finalizeInTransaction(tx, facilityId, invoiceId, userId, {});

    let payment: { id: string; receipt_number: string | null } | null = null;
    if (body.payment.mode !== 'CREDIT' && total > 0.005) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { billingPartyId: true } });
      const recorded = await this.payments.recordInTransaction(tx, {
        facilityId,
        createdBy: userId,
        role,
        partyId: inv.billingPartyId,
        paymentDate: businessDate(),
        amountPkr: total,
        paymentMethod: body.payment.mode,
        referenceNumber: body.payment.reference_number,
        chequeDate: body.payment.cheque_date,
        allocations: [{ target: 'INVOICE', invoice_id: invoiceId, allocated_amount_pkr: total }],
      });
      payment = { id: recorded.id, receipt_number: recorded.receipt_number ?? null };
    }

    return { outbound, invoice, payment };
  }

  /** The service charges marked apply_at_dispatch, priced for this withdrawal. */
  private async defaultServiceLines(
    tx: Prisma.TransactionClient,
    facilityId: string,
    load: { bags: number; weightKg: number | null },
  ) {
    const charges = await tx.serviceCharge.findMany({
      where: { facilityId, isActive: true, applyAtDispatch: true },
      orderBy: { name: 'asc' },
    });
    return charges.map((c) => {
      const unitPricePkr = Number(c.unitPricePkr);
      const quantity =
        c.unitType === 'FLAT' ? 1 : c.unitType === 'PER_BAG' ? load.bags : tonnes(load.weightKg ?? 0);
      return {
        serviceChargeId: c.id,
        description: c.name,
        quantity,
        unitPricePkr,
        amountPkr: round2(quantity * unitPricePkr),
      };
    });
  }
}

function isDeadlock(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === 'P2034' || /deadlock detected|40P01/.test(err?.message ?? '');
}
