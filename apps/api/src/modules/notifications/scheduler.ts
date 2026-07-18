import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Prisma } from '@coldchain/db';
import type { NotificationSettingsType } from '@coldchain/shared';
import { resolveFacilitySettings } from '../facility/facility.service';
import { DigestService } from './digest.service';

const TICK_MS = 5 * 60 * 1000; // check every 5 minutes
const STATE_KEY = 'notifications_state';
const DEFAULT_CATCHUP_HOURS = 3;

interface NotificationsState {
  last_digest_date?: string;
}

function readState(raw: Prisma.JsonValue): NotificationsState {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const s = (raw as Record<string, unknown>)[STATE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) return s as NotificationsState;
  }
  return {};
}

/**
 * The facility's own local calendar date, as YYYY-MM-DD. Deliberately NOT
 * `now.toISOString().slice(0, 10)` — that's the UTC date, which disagrees
 * with the local date for part of the day in any timezone ahead of UTC (e.g.
 * Asia/Karachi, UTC+5, disagrees before ~05:00 local). Using the UTC date
 * here made the "already sent today" check compare against the wrong day.
 */
export function localDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether a facility's digest is due right now. Pure so the scheduling rule can
 * be unit-tested with a fixed clock: enabled, the local hour is within the
 * catch-up window of the configured hour, and it hasn't already gone out
 * today. The window (default 3h) means a box that was powered off at
 * digest_hour still sends once it boots, instead of silently skipping the
 * day — it just never fires before digest_hour or once the window has
 * passed, so it never crosses into the next calendar day.
 */
export function isDigestDue(
  notifications: NotificationSettingsType | undefined,
  state: NotificationsState,
  now: Date,
  catchupHours: number = DEFAULT_CATCHUP_HOURS,
): boolean {
  if (!notifications?.daily_digest_enabled) return false;
  const hour = now.getHours();
  const targetHour = notifications.digest_hour;
  if (hour < targetHour || hour >= targetHour + catchupHours) return false;
  return state.last_digest_date !== localDateString(now);
}

async function persistLastDigestDate(prisma: PrismaClient, facilityId: string, date: string) {
  const row = await prisma.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
  const cur =
    row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? { ...(row.settings as Record<string, unknown>) }
      : {};
  const prevState = (cur[STATE_KEY] as NotificationsState | undefined) ?? {};
  cur[STATE_KEY] = { ...prevState, last_digest_date: date };
  await prisma.facility.update({ where: { id: facilityId }, data: { settings: cur as Prisma.InputJsonValue } });
}

/**
 * Start the background digest scheduler: every few minutes, send the daily
 * digest to any facility whose configured hour has arrived and hasn't received
 * one today. Disabled under test/reset envs. Fully self-contained and
 * try/caught so a bad facility never takes the timer down. Returns the handle
 * (or null when disabled) so the server can clear it on shutdown.
 */
export function startNotificationScheduler(app: FastifyInstance): NodeJS.Timeout | null {
  if (process.env['NODE_ENV'] === 'test' || process.env['ALLOW_TEST_RESET'] === '1') return null;

  const digest = new DigestService(app.prisma, app.mailService);

  const tick = async () => {
    try {
      const facilities = await app.prisma.facility.findMany({ select: { id: true, settings: true } });
      const now = new Date();
      const today = localDateString(now);
      for (const f of facilities) {
        try {
          const settings = resolveFacilitySettings(f.settings);
          if (!isDigestDue(settings.notifications, readState(f.settings), now)) continue;
          const result = await digest.sendNow(f.id);
          if (result.sent) await persistLastDigestDate(app.prisma, f.id, today);
        } catch (err) {
          app.log.error({ err, facilityId: f.id }, 'daily digest failed for facility');
        }
      }
    } catch (err) {
      app.log.error({ err }, 'notification scheduler tick failed');
    }
  };

  const handle = setInterval(() => void tick(), TICK_MS);
  handle.unref?.(); // never keep the process alive just for the digest timer
  return handle;
}
