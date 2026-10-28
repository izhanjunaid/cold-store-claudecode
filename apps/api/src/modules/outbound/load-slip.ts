import type { PrismaClient } from '@coldchain/db';
import { BUSINESS_TIME_ZONE, normalizePlate, round2, sumMoney } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { standingCreditCover } from '../credit-approval/credit-approval.service';
import { openLoads } from '../gate-pass/open-load';
import type { LoadSlipData } from '../pdf/pdf.service';

/** A moment on the facility's clock, as the slip prints it ("21 Oct 2026, 03:30"). */
export const slipTime = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' });

/**
 * What the driver is handed for a truck: every lot on it with its bill, the receipts that paid
 * them, and what went on credit and on whose say (the original D3 design's parchi control). While
 * the truck is inside its lines are the open load (the gate's reading); once it has left they are
 * the withdrawals its pass stamped.
 */
export async function buildLoadSlip(
  db: PrismaClient,
  facilityId: string,
  passId: string,
  printedBy: string,
): Promise<LoadSlipData> {
  const pass = await db.gatePass.findFirst({
    where: { id: passId, facilityId },
    select: {
      id: true,
      passNumber: true,
      vehicleNumber: true,
      driverName: true,
      createdAt: true,
      status: true,
      creditAuthorizedBy: true,
      creditApprovalIds: true,
    },
  });
  if (!pass) throw Errors.GATE_PASS_NOT_FOUND();
  if (pass.status === 'CANCELLED') throw Errors.GATE_PASS_INVALID_STATE('This gate pass was cancelled');

  const ids =
    pass.status === 'CLEARED'
      ? (await db.outboundEvent.findMany({ where: { facilityId, gatePassId: pass.id }, select: { id: true } })).map((o) => o.id)
      : ((await openLoads(db, facilityId, [pass.vehicleNumber])).get(normalizePlate(pass.vehicleNumber)) ?? []).map((l) => l.id);

  const lines = await db.outboundEvent.findMany({
    where: { facilityId, id: { in: ids } },
    select: {
      dispatchNoteNumber: true,
      status: true,
      quantityWithdrawnBags: true,
      finalizedBy: true,
      lot: { select: { lotNumber: true, marka: true, commodity: { select: { name: true } }, billingParty: { select: { id: true, name: true } } } },
      ownerPartySnapshot: { select: { name: true } },
      invoice: {
        select: { id: true, invoiceNumber: true, totalPkr: true, amountPaidPkr: true, billingParty: { select: { id: true, name: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  // Who a line is billed to: its bill's party once it has one (the lot may change hands later), else the lot's.
  const billedTo = (l: (typeof lines)[number]) => l.invoice?.billingParty ?? l.lot.billingParty;

  const invoiceIds = lines.flatMap((l) => (l.invoice ? [l.invoice.id] : []));
  const allocations = await db.paymentAllocation.findMany({
    where: { invoiceId: { in: invoiceIds }, voidedAt: null },
    select: {
      invoiceId: true,
      allocatedAmountPkr: true,
      payment: {
        select: {
          id: true,
          receiptNumber: true,
          paymentMethod: true,
          clearanceStatus: true,
          party: { select: { name: true } },
          createdByUser: { select: { name: true } },
        },
      },
    },
  });
  const receipts = new Map<string, LoadSlipData['receipts'][number]>();
  // A cheque not yet cleared is still owed (the gate's rule, standingCreditCover's too), though the
  // ledger already counts it paid: it is added back to what the party owes below.
  const unclearedByInvoice = new Map<string, number>();
  for (const a of allocations) {
    const uncleared = a.payment.clearanceStatus === 'PENDING';
    const r = receipts.get(a.payment.id) ?? {
      receiptNumber: a.payment.receiptNumber ?? '—',
      mode: uncleared ? `${a.payment.paymentMethod} (not cleared)` : a.payment.paymentMethod,
      partyName: a.payment.party.name,
      collectedBy: a.payment.createdByUser.name,
      amountPkr: 0,
    };
    r.amountPkr = round2(r.amountPkr + Number(a.allocatedAmountPkr));
    receipts.set(a.payment.id, r);
    if (uncleared && a.invoiceId) {
      unclearedByInvoice.set(a.invoiceId, round2((unclearedByInvoice.get(a.invoiceId) ?? 0) + Number(a.allocatedAmountPkr)));
    }
  }

  // What each party still owes on these bills, and who let it leave owing. Once the truck has left,
  // the gate's own record: the standing approval it went out on, else the manager who authorized the
  // credit there. While it is inside: the party's standing approval when it covers what the party owes,
  // else whoever dispatched the bill (a manager — the solo door takes no credit an approval does not cover).
  const wentOutOn =
    pass.status === 'CLEARED' && pass.creditApprovalIds.length > 0
      ? await db.partyCreditApproval.findMany({ where: { id: { in: pass.creditApprovalIds } }, select: { partyId: true, approvedBy: true } })
      : [];
  const credit: LoadSlipData['credit'] = [];
  for (const party of new Map(lines.map((l) => [billedTo(l).id, billedTo(l)])).values()) {
    const own = lines.filter((l) => billedTo(l).id === party.id && l.invoice);
    const owed = sumMoney(
      own.map((l) => Number(l.invoice!.totalPkr) - Number(l.invoice!.amountPaidPkr) + (unclearedByInvoice.get(l.invoice!.id) ?? 0)),
    );
    if (owed <= 0.005) continue;
    const dispatchedBy = own.find((l) => l.finalizedBy)?.finalizedBy ?? null;
    let authorizerId: string | null;
    let standing: boolean;
    if (pass.status === 'CLEARED') {
      const approval = wentOutOn.find((a) => a.partyId === party.id);
      authorizerId = approval?.approvedBy ?? pass.creditAuthorizedBy ?? dispatchedBy;
      standing = approval != null;
    } else {
      const cover = await standingCreditCover(db, facilityId, [{ partyId: party.id }]);
      authorizerId = cover.covered ? cover.approvals[0]!.approvedBy : dispatchedBy;
      standing = cover.covered;
    }
    const authorizer = authorizerId ? await db.user.findUnique({ where: { id: authorizerId }, select: { name: true } }) : null;
    credit.push({ partyName: party.name, amountPkr: owed, authorizedBy: authorizer?.name ?? '—', standing });
  }

  const facility = await db.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { name: true, city: true } });
  const printer = await db.user.findUnique({ where: { id: printedBy }, select: { name: true } });
  return {
    facilityName: facility.name,
    facilityCity: facility.city,
    passNumber: pass.passNumber,
    vehicleNumber: pass.vehicleNumber,
    driverName: pass.driverName,
    arrivedAt: slipTime(pass.createdAt),
    printedAt: slipTime(new Date()),
    printedBy: printer?.name ?? '—',
    left: pass.status === 'CLEARED',
    lines: lines.map((l) => ({
      dispatchNoteNumber: l.dispatchNoteNumber ?? '—',
      lotNumber: l.lot.lotNumber,
      marka: l.lot.marka,
      commodityName: l.lot.commodity?.name ?? null,
      ownerName: l.ownerPartySnapshot?.name ?? null,
      billingPartyName: billedTo(l).name,
      bags: l.quantityWithdrawnBags,
      status: l.status,
      invoiceNumber: l.invoice?.invoiceNumber ?? null,
      totalPkr: l.invoice ? Number(l.invoice.totalPkr) : null,
      paidPkr: l.invoice ? Number(l.invoice.amountPaidPkr) : null,
    })),
    receipts: [...receipts.values()],
    credit,
    totalBags: lines.reduce((s, l) => s + l.quantityWithdrawnBags, 0),
    totalBilledPkr: sumMoney(lines.map((l) => (l.invoice ? Number(l.invoice.totalPkr) : 0))),
    totalReceivedPkr: sumMoney([...receipts.values()].map((r) => r.amountPkr)),
    totalCreditPkr: sumMoney(credit.map((c) => c.amountPkr)),
  };
}
