import type { PrismaClient, Prisma } from '@coldchain/db';
import { businessDate, toIsoDate, type ManagerReasonCode } from '@coldchain/shared';
import { resolveFacilitySettings } from '../facility/facility.service';

/** What the solo rules read once per facility, not once per withdrawal. */
export type SoloContext = { soloOn: boolean; perTonCharges: number; today: string };

export async function loadSoloContext(db: PrismaClient | Prisma.TransactionClient, facilityId: string): Promise<SoloContext> {
  const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
  const perTonCharges = await db.serviceCharge.count({
    where: { facilityId, isActive: true, applyAtDispatch: true, unitType: 'PER_TON', unitPricePkr: { gt: 0 } },
  });
  return {
    soloOn: resolveFacilitySettings(facility?.settings ?? null).dispatch_solo_mode,
    perTonCharges,
    today: businessDate(),
  };
}

/**
 * May the munshi finish this withdrawal alone? The owner's switch, a PACCI lot, a withdrawal dated
 * today (its date ends the storage billed) and no default charge priced by weight (the munshi typed the
 * weight), checked in that order; the first that fails is the reason a manager is needed. The checkout,
 * the previews and the managers' waiting list all ask this one function, so they cannot disagree.
 */
export function soloRefusal(
  ctx: SoloContext,
  lot: { bookType: string },
  outboundDate: Date,
): Extract<ManagerReasonCode, 'SOLO_OFF' | 'KATCHI' | 'NOT_TODAY' | 'PER_TON_CHARGE'> | null {
  if (!ctx.soloOn) return 'SOLO_OFF';
  if (lot.bookType !== 'PACCI') return 'KATCHI';
  if (toIsoDate(outboundDate) !== ctx.today) return 'NOT_TODAY';
  if (ctx.perTonCharges > 0) return 'PER_TON_CHARGE';
  return null;
}
