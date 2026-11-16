import type { Prisma, PrismaClient } from '@coldchain/db';
import { businessDate, fromIsoDate, toIsoDate, type FacilitySettingsType } from '@coldchain/shared';
import { resolveFacilitySettings } from './facility.service';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Dated settings (docs/32 section 2.2).
 *
 * `facilities.settings` holds what is in force now. `facility_setting_versions` holds
 * every saved change of a business setting with the day it takes effect: the history,
 * and the changes dated ahead that are still waiting.
 *
 * Read a setting through `settingsOn` and name the day: today for a live rule (may this
 * be backdated? is solo dispatch on?), the document's own date for anything a bill,
 * receipt or payslip is priced with. A change dated 1 July then never alters a paper
 * dated in June, whenever that paper is made.
 */

/** Keys that are not business rules: mail and notification plumbing, and internal state. They carry no date. */
export const UNDATED_SETTINGS_KEYS = ['email', 'notifications', 'permissions', 'notifications_state'];

/** The baseline row of a setting: the value it had before its first saved change. */
export const BASELINE_DATE = '1900-01-01';

export async function settingsOn(db: Db, facilityId: string, on?: Date | string): Promise<FacilitySettingsType> {
  const today = businessDate();
  const day = on === undefined ? today : typeof on === 'string' ? on : toIsoDate(on);
  const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
  const settings = { ...resolveFacilitySettings(facility?.settings ?? null) } as Record<string, unknown>;

  const versions = await db.facilitySettingVersion.findMany({
    where: {
      facilityId,
      effectiveFrom: { lte: fromIsoDate(day) },
      // Today or ahead: what is in force now, plus changes due by that day and not applied yet.
      // A past day: the whole history up to it.
      ...(day >= today ? { appliedAt: null } : {}),
    },
    orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    select: { key: true, value: true },
  });
  for (const v of versions) settings[v.key] = v.value;
  return settings as unknown as FacilitySettingsType;
}

/**
 * Apply the changes whose day has come to `facilities.settings`, in order. Reads through
 * `settingsOn` are already right without it; this keeps the stored "now" (and anything
 * that still reads the column directly, the previous image included) in step.
 */
export async function applyDueSettings(prisma: PrismaClient, facilityId: string): Promise<number> {
  const due = { facilityId, appliedAt: null, effectiveFrom: { lte: fromIsoDate(businessDate()) } };
  if ((await prisma.facilitySettingVersion.count({ where: due })) === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.facilitySettingVersion.findMany({ where: due, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] });
    if (rows.length === 0) return 0;
    const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { settings: true } });
    const stored =
      facility.settings && typeof facility.settings === 'object' && !Array.isArray(facility.settings)
        ? { ...(facility.settings as Record<string, unknown>) }
        : {};
    for (const r of rows) stored[r.key] = r.value;
    await tx.facility.update({ where: { id: facilityId }, data: { settings: stored as Prisma.InputJsonValue } });
    await tx.facilitySettingVersion.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { appliedAt: new Date() } });
    return rows.length;
  });
}
