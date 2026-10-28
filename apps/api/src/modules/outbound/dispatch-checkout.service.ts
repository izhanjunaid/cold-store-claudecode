import type { PrismaClient, Prisma, BookType } from '@coldchain/db';
import {
  addDays,
  businessDate,
  businessDayStart,
  normalizePlate,
  round2,
  sumMoney,
  toIsoDate,
  TRUCK_MAX_LINES,
  type DispatchAndCollectRequestType,
  type OutboundListQueryType,
  type TruckDispatchRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { lockRow } from '../../common/row-lock';
import { findActiveApproval, standingCreditCover } from '../credit-approval/credit-approval.service';
import { openLoads, type OpenLoadLine } from '../gate-pass/open-load';
import { resolveFacilitySettings } from '../facility/facility.service';
import { previewInvoiceFromOutbound } from '../invoice/invoice.builder';
import { invoiceTotals } from '../invoice/invoice-totals';
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

/** One withdrawal in a checkout, with what the reviewer saw for it. */
interface CheckoutLine {
  outboundId: string;
  /** The total its bill showed when it was reviewed: this posts, or nothing does. */
  expectedTotal: number;
  skipIds?: string[];
  pickedFrom?: { rackId: string; bags: number }[];
  notes?: string;
}

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
    const { bill, lot, outboundDate } = await this.priceLine(facilityId, id);
    // Whether the munshi may finish this truck alone, as booleans and a reason: never the party's
    // ceiling or exposure. Credit is offered only if this bill fits under the approved ceiling.
    const verdict = await this.soloVerdict(this.prisma, facilityId, lot, outboundDate);
    const creditAvailable =
      verdict.allowed &&
      verdict.creditApproved &&
      (await standingCreditCover(this.prisma, facilityId, [{ partyId: lot.billingPartyId, unbilled: bill.total_pkr }])).covered;
    return {
      ...bill,
      solo: verdict.allowed
        ? { allowed: true, credit_available: creditAvailable }
        : { allowed: false, reason: verdict.reason, credit_available: false },
    };
  }

  /** One weighed withdrawal's bill, priced as it will post: the review step of both checkouts. */
  private async priceLine(facilityId: string, id: string) {
    const ob = await this.prisma.outboundEvent.findFirst({
      where: { id, facilityId },
      include: {
        lot: { select: { lotNumber: true, bookType: true, billingPartyId: true, billingParty: { select: { id: true, name: true } } } },
      },
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
    // The same function InvoiceRepository.recomputeTotals prices the built bill with, over the
    // same lines (storage first, then the default charges), so what is reviewed is what posts.
    const {
      subTotal,
      gst: gstAmount,
      total,
    } = invoiceTotals({
      lineAmounts: [priced.charge.amountPkr, ...defaults.map((l) => l.amountPkr)],
      gstRate: priced.gstRate,
      bookType: priced.params.bookType,
    });

    const bill = {
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
      total_pkr: total,
    };
    return { bill, lot: ob.lot, outboundDate: ob.outboundDate };
  }

  /** The trucks inside the gate, one per plate (its newest pass), each with what is on it. */
  async trucks(facilityId: string) {
    const passes = await this.prisma.gatePass.findMany({
      where: { facilityId, status: { in: ['ARRIVED', 'WEIGHING'] } },
      select: { id: true, passNumber: true, vehicleNumber: true, driverName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const byPlate = new Map<string, (typeof passes)[number]>();
    for (const p of passes) {
      const plate = normalizePlate(p.vehicleNumber);
      if (plate && !byPlate.has(plate)) byPlate.set(plate, p);
    }
    const loads = await openLoads(this.prisma, facilityId, [...byPlate.keys()]);
    return [...byPlate.entries()]
      .map(([plate, pass]) => {
        const lines = loads.get(plate) ?? [];
        return {
          gate_pass_id: pass.id,
          pass_number: pass.passNumber,
          vehicle_number: pass.vehicleNumber,
          driver_name: pass.driverName,
          arrived_at: pass.createdAt.toISOString(),
          ready: lines.some((l) => l.status === 'WEIGHED') && !lines.some((l) => NOT_READY.has(l.status)),
          lines: lines.map(truckLine),
        };
      })
      .sort((a, b) => a.arrived_at.localeCompare(b.arrived_at));
  }

  /** A whole truck's review: each weighed line's bill, the payment groups, and whether the munshi may finish it. */
  async truckPreview(facilityId: string, passId: string) {
    const { pass, lines } = await this.truckLoad(this.prisma, facilityId, passId);
    const priced = [];
    for (const l of lines.filter((x) => x.status === 'WEIGHED')) priced.push(await this.priceLine(facilityId, l.id));

    let solo: { allowed: true } | { allowed: false; reason: string } =
      priced.length > 0 ? { allowed: true } : { allowed: false, reason: 'nothing on this truck is weighed' };
    const approved = new Set<string>();
    for (const p of priced) {
      const verdict = await this.soloVerdict(this.prisma, facilityId, p.lot, p.outboundDate);
      if (!verdict.allowed) {
        solo = { allowed: false, reason: `${p.bill.dispatch_note_number ?? p.bill.outbound_id}: ${verdict.reason}` };
        break;
      }
      if (verdict.creditApproved) approved.add(p.lot.billingPartyId);
    }

    const groups = [];
    for (const g of groupBills(priced.map((p) => p.bill))) {
      // Credit is offered only if every bill of the party on this truck fits under its ceiling together.
      const creditAvailable =
        solo.allowed &&
        approved.has(g.billing_party.id) &&
        (await standingCreditCover(this.prisma, facilityId, [{ partyId: g.billing_party.id, unbilled: g.total_pkr }])).covered;
      groups.push({ ...g, credit_available: creditAvailable });
    }

    return {
      gate_pass_id: pass.id,
      pass_number: pass.passNumber,
      vehicle_number: pass.vehicleNumber,
      lines: priced.map((p) => p.bill),
      not_ready: lines.filter((l) => NOT_READY.has(l.status)).map(dnOf),
      groups,
      total_pkr: sumMoney(priced.map((p) => p.bill.total_pkr)),
      solo,
    };
  }

  /**
   * Check out a whole truck — every weighed line dispatched and billed, one receipt per
   * (party, book) — or nothing. The load and the payment rows are checked before anything is
   * written, and again under the locks.
   */
  async truckDispatchAndCollect(caller: CheckoutCaller, passId: string, body: TruckDispatchRequestType) {
    if (body.lines.length > TRUCK_MAX_LINES) throw Errors.TRUCK_TOO_MANY_LINES(TRUCK_MAX_LINES);
    const { lines } = await this.truckLoad(this.prisma, caller.facilityId, passId);
    checkTruckRequest(lines, body);
    const solo = await this.authorizeTruck(caller, lines, body);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction((tx) => this.runTruck(tx, caller, passId, body, solo), {
          timeout: 60_000,
          maxWait: 10_000,
        });
      } catch (e) {
        if (attempt < 1 && isDeadlock(e)) continue;
        throw e;
      }
    }
  }

  /** A truck inside the gate and what is on it: the gate's own reading (open-load.ts). */
  private async truckLoad(db: PrismaClient | Prisma.TransactionClient, facilityId: string, passId: string) {
    const pass = await db.gatePass.findFirst({
      where: { id: passId, facilityId },
      select: { id: true, passNumber: true, vehicleNumber: true, status: true },
    });
    if (!pass) throw Errors.GATE_PASS_NOT_FOUND();
    if (pass.status !== 'ARRIVED' && pass.status !== 'WEIGHING') {
      throw Errors.GATE_PASS_INVALID_STATE('This truck is no longer inside the gate');
    }
    const lines = (await openLoads(db, facilityId, [pass.vehicleNumber])).get(normalizePlate(pass.vehicleNumber)) ?? [];
    return { pass, lines };
  }

  /** The truck's version of authorize(): the manager keys, or the solo door for every line and every payment. */
  private async authorizeTruck(caller: CheckoutCaller, lines: OpenLoadLine[], body: TruckDispatchRequestType) {
    const need = ['outbound.finalize', 'invoices.manage'];
    if (body.payments.some((p) => p.mode !== 'CREDIT')) need.push('payments.record');
    const missing = need.find((key) => !caller.permissions.has(key));
    if (!missing) return false;

    const refuse = (reason: string): never => {
      if (caller.permissions.has('outbound.finalize')) throw Errors.FORBIDDEN(`Missing permission: ${missing}`);
      throw Errors.DISPATCH_NEEDS_MANAGER(reason);
    };
    const approved = new Set<string>();
    for (const l of lines.filter((x) => x.status === 'WEIGHED')) {
      const verdict = await this.soloVerdict(
        this.prisma,
        caller.facilityId,
        { bookType: l.lot.bookType, billingPartyId: l.lot.billingParty.id },
        l.outboundDate,
      );
      if (!verdict.allowed) return refuse(`${dnOf(l)}: ${verdict.reason}`);
      if (verdict.creditApproved) approved.add(l.lot.billingParty.id);
    }
    if (body.lines.some((l) => (l.skip_service_charge_ids ?? []).length > 0)) {
      return refuse('leaving a charge off the bill is a manager decision');
    }
    for (const p of body.payments) {
      if (p.mode === 'CREDIT') {
        if (!approved.has(p.billing_party_id)) return refuse('a party on this truck has no standing credit approval');
      } else if (p.mode !== 'CASH') {
        return refuse('only cash or approved credit can be taken without a manager');
      }
    }
    return true;
  }

  private async runTruck(
    tx: Prisma.TransactionClient,
    caller: CheckoutCaller,
    passId: string,
    body: TruckDispatchRequestType,
    solo: boolean,
  ) {
    const { facilityId, userId, role } = caller;
    // The truck first (gate_passes → outbound_events → lots), so the gate cannot release it mid-checkout;
    // then its lines and their lots; only then the load again, now that nothing on it can move — a line
    // checked out on its own meanwhile, or this truck sent twice, shows up here as what it is.
    if (!(await lockRow(tx, 'gate_passes', passId, facilityId))) throw Errors.GATE_PASS_NOT_FOUND();
    await this.lockLoad(tx, facilityId, body.lines.map((l) => l.outbound_id));
    checkTruckRequest((await this.truckLoad(tx, facilityId, passId)).lines, body);
    // Solo credit: each party's credit lock, in party order, before any of its bills post.
    const creditParties = solo
      ? [...new Set(body.payments.filter((p) => p.mode === 'CREDIT').map((p) => p.billing_party_id))].sort()
      : [];
    for (const partyId of creditParties) await advisoryXactLock(tx, `${facilityId}:party-credit:${partyId}`);

    const done = [];
    for (const line of [...body.lines].sort((a, b) => a.outbound_id.localeCompare(b.outbound_id))) {
      done.push(
        await this.dispatchLine(
          tx,
          caller,
          {
            outboundId: line.outbound_id,
            expectedTotal: line.expected_total_pkr,
            skipIds: line.skip_service_charge_ids,
            pickedFrom: line.picked_from?.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
            notes: body.notes,
          },
          { nameLine: true },
        ),
      );
    }
    // Every bill is in the ledger: each solo credit party must still sit under its ceiling with all of them.
    for (const partyId of creditParties) {
      const cover = await standingCreditCover(tx, facilityId, [{ partyId }]);
      if (!cover.covered) throw Errors.DISPATCH_NEEDS_MANAGER('these bills would take a party past its approved credit');
    }

    const payments = [];
    for (const p of body.payments) {
      if (p.mode === 'CREDIT') continue;
      const bills = done.filter((d) => d.billingPartyId === p.billing_party_id && d.bookType === p.book_type);
      const amount = sumMoney(bills.map((b) => b.total));
      if (amount <= 0.005) continue;
      const recorded = await this.payments.recordInTransaction(tx, {
        facilityId,
        createdBy: userId,
        role,
        partyId: p.billing_party_id,
        paymentDate: businessDate(),
        amountPkr: amount,
        paymentMethod: p.mode,
        referenceNumber: p.reference_number,
        chequeDate: p.cheque_date,
        allocations: bills.map((b) => ({ target: 'INVOICE' as const, invoice_id: b.invoiceId, allocated_amount_pkr: b.total })),
      });
      payments.push({
        id: recorded.id,
        receipt_number: recorded.receipt_number ?? null,
        billing_party_id: p.billing_party_id,
        book_type: p.book_type,
        amount_pkr: amount,
      });
    }
    return { gate_pass_id: passId, lines: done.map((d) => ({ outbound: d.outbound, invoice: d.invoice })), payments };
  }

  /**
   * Dispatch, bill and collect — or fail whole. Order inside the transaction: the
   * withdrawal and its lot lock and move (finalize), the bill gets its default service
   * lines, the total is checked against what the client reviewed, the bill is finalized
   * (JE-01), and the money is recorded against it (JE-02). A refusal at any step leaves
   * no trace of the earlier ones.
   */
  async dispatchAndCollect(caller: CheckoutCaller, id: string, body: DispatchAndCollectRequestType) {
    const solo = await this.authorize(caller, id, body);

    // Two checkouts racing for the numbering locks can deadlock; the loser is safe to rerun.
    for (let attempt = 0; ; attempt++) {
      try {
        // The checkout does many steps (dispatch, bill, two journal entries): more than Prisma's 5 s default.
        return await this.prisma.$transaction((tx) => this.run(tx, caller, id, body, solo), { timeout: 30_000, maxWait: 10_000 });
      } catch (e) {
        if (attempt < 1 && isDeadlock(e)) continue;
        throw e;
      }
    }
  }

  /**
   * Who may run the checkout. A caller holding every key the steps need (the manager path) always
   * may; the refusal names the missing one, before any write. Anyone else qualifies only through
   * the owner's solo switch — cash in full, or credit a standing approval covers, on a PACCI bill
   * with every default charge kept — and is otherwise told a manager must finish the truck.
   * Returns whether the caller is going through the solo door.
   */
  private async authorize(caller: CheckoutCaller, id: string, body: DispatchAndCollectRequestType): Promise<boolean> {
    const need = ['outbound.finalize', 'invoices.manage'];
    if (body.payment.mode !== 'CREDIT') need.push('payments.record');
    const missing = need.find((key) => !caller.permissions.has(key));
    if (!missing) return false;

    // A manager-level caller with an owner-customised matrix keeps the plain message; a munshi is
    // told why a manager is needed.
    const refuse = (reason: string): never => {
      if (caller.permissions.has('outbound.finalize')) throw Errors.FORBIDDEN(`Missing permission: ${missing}`);
      throw Errors.DISPATCH_NEEDS_MANAGER(reason);
    };

    const ob = await this.prisma.outboundEvent.findFirst({
      where: { id, facilityId: caller.facilityId },
      select: { outboundDate: true, lot: { select: { bookType: true, billingPartyId: true } } },
    });
    if (!ob) throw Errors.OUTBOUND_NOT_FOUND();

    const verdict = await this.soloVerdict(this.prisma, caller.facilityId, ob.lot, ob.outboundDate);
    if (!verdict.allowed) return refuse(verdict.reason);
    if ((body.skip_service_charge_ids ?? []).length > 0) return refuse('leaving a charge off the bill is a manager decision');
    if (body.payment.mode === 'CREDIT') {
      if (!verdict.creditApproved) return refuse('this party has no standing credit approval');
    } else if (body.payment.mode !== 'CASH') {
      return refuse('only cash or approved credit can be taken without a manager');
    }
    return true;
  }

  /**
   * May the munshi finish this truck alone? Needs the owner's switch, a PACCI lot, a withdrawal dated
   * today (its date ends the storage billed) and no default charge priced by weight (the munshi typed
   * the weight). `creditApproved`
   * says the billing party holds a live standing approval; whether the bill fits under its ceiling
   * is checked at the checkout, under a lock, once the bill is in the ledger.
   */
  private async soloVerdict(
    db: PrismaClient | Prisma.TransactionClient,
    facilityId: string,
    lot: { bookType: string; billingPartyId: string },
    outboundDate: Date,
  ): Promise<{ allowed: true; creditApproved: boolean } | { allowed: false; reason: string; creditApproved: false }> {
    const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
    if (!resolveFacilitySettings(facility?.settings ?? null).dispatch_solo_mode) {
      return { allowed: false, reason: 'the owner has not switched on one-person dispatch', creditApproved: false };
    }
    if (lot.bookType !== 'PACCI') {
      return { allowed: false, reason: 'a KATCHI-book bill is a manager decision', creditApproved: false };
    }
    if (toIsoDate(outboundDate) !== businessDate()) {
      return { allowed: false, reason: 'a withdrawal not dated today is a manager decision', creditApproved: false };
    }
    const byWeight = await db.serviceCharge.count({
      where: { facilityId, isActive: true, applyAtDispatch: true, unitType: 'PER_TON', unitPricePkr: { gt: 0 } },
    });
    if (byWeight > 0) {
      return { allowed: false, reason: 'a charge priced by the weight is a manager decision', creditApproved: false };
    }
    const approval = await findActiveApproval(db, facilityId, lot.billingPartyId);
    return { allowed: true, creditApproved: approval != null };
  }

  private async run(
    tx: Prisma.TransactionClient,
    caller: CheckoutCaller,
    id: string,
    body: DispatchAndCollectRequestType,
    solo: boolean,
  ) {
    const { facilityId, userId, role } = caller;

    const locked = (await this.lockLoad(tx, facilityId, [id])).get(id);
    if (!locked) throw Errors.OUTBOUND_NOT_FOUND();
    // Two solo credit dispatches for one party must not both pass the ceiling: take the party's
    // credit lock now (after the outbound/lot locks, the order everything else uses) so the second
    // one sees the first one's bill in the ledger. (The document-number locks taken further down
    // happen to serialise two checkouts too, so the race test passes without this lock; it is here
    // so the ceiling does not depend on that.)
    const soloCredit = solo && body.payment.mode === 'CREDIT';
    if (soloCredit) await advisoryXactLock(tx, `${facilityId}:party-credit:${locked.billingPartyId}`);

    const done = await this.dispatchLine(tx, caller, {
      outboundId: id,
      expectedTotal: body.expected_total_pkr,
      skipIds: body.skip_service_charge_ids,
      pickedFrom: body.picked_from?.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
      notes: body.notes,
    });

    // The bill is in the ledger now, so the party's exposure includes it: it must still sit under the ceiling.
    if (soloCredit) {
      const cover = await standingCreditCover(tx, facilityId, [{ partyId: done.billingPartyId }]);
      if (!cover.covered) throw Errors.DISPATCH_NEEDS_MANAGER('this bill would take the party past its approved credit');
    }

    let payment: { id: string; receipt_number: string | null } | null = null;
    if (body.payment.mode !== 'CREDIT' && done.total > 0.005) {
      const recorded = await this.payments.recordInTransaction(tx, {
        facilityId,
        createdBy: userId,
        role,
        partyId: done.billingPartyId,
        paymentDate: businessDate(),
        amountPkr: done.total,
        paymentMethod: body.payment.mode,
        referenceNumber: body.payment.reference_number,
        chequeDate: body.payment.cheque_date,
        allocations: [{ target: 'INVOICE', invoice_id: done.invoiceId, allocated_amount_pkr: done.total }],
      });
      payment = { id: recorded.id, receipt_number: recorded.receipt_number ?? null };
    }

    return { outbound: done.outbound, invoice: done.invoice, payment };
  }

  /**
   * Lock a checkout's withdrawals, then the lots they draw on — each set in id order, so two
   * checkouts that share lots (two trucks each taking part of the same lots) queue instead of
   * deadlocking. The per-line steps lock the same rows again, which a transaction already holding
   * them passes straight through. Lock order everywhere: gate_passes → outbound_events → lots.
   */
  private async lockLoad(
    tx: Prisma.TransactionClient,
    facilityId: string,
    outboundIds: string[],
  ): Promise<Map<string, { lotId: string; billingPartyId: string; bookType: BookType }>> {
    for (const id of [...outboundIds].sort()) {
      if (!(await lockRow(tx, 'outbound_events', id, facilityId))) throw Errors.OUTBOUND_NOT_FOUND();
    }
    const rows = await tx.outboundEvent.findMany({
      where: { facilityId, id: { in: outboundIds } },
      select: { id: true, lotId: true, lot: { select: { billingPartyId: true, bookType: true } } },
    });
    for (const lotId of [...new Set(rows.map((r) => r.lotId))].sort()) {
      if (!(await lockRow(tx, 'lots', lotId, facilityId))) throw Errors.LOT_NOT_FOUND();
    }
    return new Map(
      rows.map((r) => [r.id, { lotId: r.lotId, billingPartyId: r.lot.billingPartyId, bookType: r.lot.bookType }]),
    );
  }

  /**
   * One withdrawal of a checkout: dispatch it (the lot moves), give its bill the default service
   * charges, check its total is the one reviewed, and finalize the bill (JE-01). Credit and money
   * are the caller's: a truck settles each party once, over all of its bills. `nameLine` puts the
   * dispatch note in a changed-total refusal, for a truck of several lines.
   */
  private async dispatchLine(
    tx: Prisma.TransactionClient,
    caller: CheckoutCaller,
    line: CheckoutLine,
    opts: { nameLine?: boolean } = {},
  ) {
    const { facilityId, userId } = caller;
    const { outbound, invoiceId } = await this.outbound.finalizeInTransaction(
      tx,
      facilityId,
      line.outboundId,
      line.notes,
      line.pickedFrom,
      userId,
    );
    const ob = await tx.outboundEvent.findUniqueOrThrow({
      where: { id: line.outboundId },
      select: { quantityWithdrawnBags: true, outboundWeightKg: true, dispatchNoteNumber: true },
    });
    const skip = new Set(line.skipIds ?? []);
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
    if (Math.abs(total - line.expectedTotal) > 0.005) {
      throw Errors.DISPATCH_TOTAL_CHANGED(
        line.expectedTotal,
        total,
        opts.nameLine ? (ob.dispatchNoteNumber ?? undefined) : undefined,
      );
    }

    const invoice = await this.invoices.finalizeInTransaction(tx, facilityId, invoiceId, userId, {});
    const bill = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { billingPartyId: true, bookType: true },
    });
    return {
      outbound,
      invoice,
      invoiceId,
      total,
      billingPartyId: bill.billingPartyId,
      bookType: bill.bookType,
      dispatchNoteNumber: ob.dispatchNoteNumber,
    };
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
    // A charge priced at nothing adds no line: a zero line would be refused at finalize.
    return charges.filter((c) => Number(c.unitPricePkr) > 0).map((c) => {
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

/** A line on a truck that is not weighed yet: the truck waits for it (no partial trucks). */
const NOT_READY = new Set(['PENDING', 'DISPUTED']);

const dnOf = (l: { dispatchNoteNumber: string | null; id: string }) => l.dispatchNoteNumber ?? l.id.slice(0, 8);

function truckLine(l: OpenLoadLine) {
  return {
    outbound_id: l.id,
    dispatch_note_number: l.dispatchNoteNumber,
    status: l.status,
    stage: stageOf({ status: l.status, gatePassId: null, invoice: l.invoice }),
    lot_id: l.lot.id,
    lot_number: l.lot.lotNumber,
    marka: l.lot.marka,
    book_type: l.lot.bookType,
    billing_party: l.lot.billingParty,
    owner_party_name: l.ownerPartySnapshot?.name ?? null,
    quantity_withdrawn_bags: l.quantityWithdrawnBags,
    outbound_weight_kg: l.outboundWeightKg == null ? null : Number(l.outboundWeightKg),
    invoice: l.invoice && {
      id: l.invoice.id,
      invoice_number: l.invoice.invoiceNumber,
      status: l.invoice.status,
      total_pkr: Number(l.invoice.totalPkr),
      balance_due_pkr: round2(Number(l.invoice.totalPkr) - Number(l.invoice.amountPaidPkr)),
    },
  };
}

/** A truck's bills by who pays and on which book: one payment row, and one receipt, per group. */
function groupBills(bills: { outbound_id: string; billing_party: { id: string; name: string }; book_type: string; total_pkr: number }[]) {
  const groups = new Map<string, { billing_party: { id: string; name: string }; book_type: string; outbound_ids: string[]; total_pkr: number }>();
  for (const b of bills) {
    const key = `${b.billing_party.id}:${b.book_type}`;
    const g = groups.get(key) ?? { billing_party: b.billing_party, book_type: b.book_type, outbound_ids: [], total_pkr: 0 };
    g.outbound_ids.push(b.outbound_id);
    g.total_pkr = round2(g.total_pkr + b.total_pkr);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** The request covers exactly the truck's weighed lines, with one payment row per (party, book) among them. */
function checkTruckRequest(lines: OpenLoadLine[], body: TruckDispatchRequestType) {
  const onTruck = new Map(lines.map((l) => [l.id, l]));
  const asked = new Set(body.lines.map((l) => l.outbound_id));
  // Sent again after it went (a retry, or the second of two at once): everything asked for is
  // already dispatched. The desk treats that as done and offers the slip.
  if (asked.size > 0 && [...asked].every((id) => onTruck.get(id)?.status === 'DISPATCHED')) {
    throw Errors.OUTBOUND_ALREADY_FINALIZED('This truck was already checked out');
  }

  const notReady = lines.filter((l) => NOT_READY.has(l.status));
  if (notReady.length > 0) throw Errors.TRUCK_NOT_READY(notReady.map(dnOf));

  const weighed = new Map(lines.filter((l) => l.status === 'WEIGHED').map((l) => [l.id, l]));
  const missing = [...weighed.values()].filter((l) => !asked.has(l.id)).map(dnOf);
  // A line asked for that is no longer weighed on this truck, by its dispatch note while the truck still carries it.
  const extra = [...asked].filter((id) => !weighed.has(id)).map((id) => (onTruck.has(id) ? dnOf(onTruck.get(id)!) : id.slice(0, 8)));
  if (missing.length > 0 || extra.length > 0 || asked.size !== body.lines.length) {
    throw Errors.TRUCK_LOAD_CHANGED(missing, extra);
  }

  const needed = new Set([...weighed.values()].map((l) => `${l.lot.billingParty.id}:${l.lot.bookType}`));
  const given = body.payments.map((p) => `${p.billing_party_id}:${p.book_type}`);
  if (new Set(given).size !== given.length) throw Errors.TRUCK_PAYMENTS_MISMATCH('a party and book is paid twice');
  if (given.some((k) => !needed.has(k))) throw Errors.TRUCK_PAYMENTS_MISMATCH('a payment row is for a party or book not on this truck');
  if ([...needed].some((k) => !given.includes(k))) throw Errors.TRUCK_PAYMENTS_MISMATCH('a party on this truck has no payment row');
}

function isDeadlock(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === 'P2034' || /deadlock detected|40P01/.test(err?.message ?? '');
}
