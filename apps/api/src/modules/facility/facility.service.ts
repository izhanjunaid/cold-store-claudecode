import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  DEFAULT_FACILITY_SETTINGS,
  businessDate,
  fiscalYearStart,
  fromIsoDate,
  toIsoDate,
  type FacilitySettingsType,
  type UpdateFacilityRequestType,
  type FacilityResponseType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { PeriodLockService } from '../accounting/period-lock.service';
import { encryptSecret } from '../../common/crypto';
import { applyDueSettings, BASELINE_DATE, settingsOn, UNDATED_SETTINGS_KEYS } from './settings-store';

// Top-level settings keys that are managed by dedicated endpoints and must never
// appear in facility responses or be writable through PATCH /v1/facilities/me
// (they live in the same JSON column so the facilities audit trigger covers them).
const INTERNAL_SETTINGS_KEYS = ['permissions', 'notifications_state'];

// Internal key inside settings.email holding the aes-256-gcm encrypted SMTP password.
const SMTP_PASSWORD_ENC_KEY = 'smtp_password_enc';

/**
 * Resolve a facility's raw JSON settings column into a fully-populated
 * settings object (missing keys fall back to defaults).
 */
export function resolveFacilitySettings(raw: Prisma.JsonValue): FacilitySettingsType {
  return mergeSettings(raw, undefined);
}

function mergeSettings(
  current: Prisma.JsonValue,
  patch: Partial<FacilitySettingsType> | undefined,
): FacilitySettingsType {
  const cur =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...DEFAULT_FACILITY_SETTINGS, ...cur };
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) merged[k] = v;
    }
  }
  return merged as unknown as FacilitySettingsType;
}

/** JSON with object keys sorted, so two equal settings values compare equal however they were built. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type VersionRow = {
  id: string;
  key: string;
  value: Prisma.JsonValue;
  effectiveFrom: Date;
  note: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  author: { name: string } | null;
};

function formatVersion(v: VersionRow) {
  return {
    id: v.id,
    key: v.key,
    value: v.value as unknown,
    effective_from: toIsoDate(v.effectiveFrom),
    note: v.note,
    saved_at: v.createdAt.toISOString(),
    saved_by_name: v.author?.name ?? null,
    in_force: v.appliedAt !== null,
  };
}

const VERSION_SELECT = {
  id: true,
  key: true,
  value: true,
  effectiveFrom: true,
  note: true,
  createdAt: true,
  appliedAt: true,
  author: { select: { name: true } },
} as const;

function format(row: {
  id: string;
  name: string;
  address: string | null;
  city: string;
  phone: string | null;
  gstNumber: string | null;
  settings: Prisma.JsonValue;
}, pending: VersionRow[] = []): FacilityResponseType {
  const merged = mergeSettings(row.settings, undefined) as unknown as Record<string, unknown>;
  for (const key of INTERNAL_SETTINGS_KEYS) delete merged[key];

  // The stored email object may carry the encrypted password — strip it and
  // expose only whether a password is set.
  const emailStored = (merged['email'] as Record<string, unknown> | undefined) ?? {};
  const emailRaw: Record<string, unknown> = { ...DEFAULT_FACILITY_SETTINGS.email, ...emailStored };
  const passwordSet = Boolean(emailRaw[SMTP_PASSWORD_ENC_KEY]);
  delete emailRaw[SMTP_PASSWORD_ENC_KEY];
  merged['email'] = { ...emailRaw, smtp_password_set: passwordSet };

  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    phone: row.phone,
    gst_number: row.gstNumber,
    settings: merged as unknown as FacilityResponseType['settings'],
    pending_settings: pending.map(formatVersion),
  };
}

export class FacilityService {
  constructor(private prisma: PrismaClient) {}

  async getFacility(facilityId: string): Promise<FacilityResponseType> {
    await applyDueSettings(this.prisma, facilityId);
    const row = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!row) throw Errors.AUTH_INVALID('Facility not found');
    return format(row, await this.pending(facilityId));
  }

  /** Changes saved for a day still ahead, soonest first. */
  private pending(facilityId: string): Promise<VersionRow[]> {
    return this.prisma.facilitySettingVersion.findMany({
      where: { facilityId, appliedAt: null },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      select: VERSION_SELECT,
    });
  }

  /** Every saved change of the business settings, newest first: what was in force and from when. */
  async settingsHistory(facilityId: string, key?: string) {
    const rows = await this.prisma.facilitySettingVersion.findMany({
      where: { facilityId, ...(key ? { key } : {}) },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: VERSION_SELECT,
    });
    return rows.map((v) => ({ ...formatVersion(v), is_baseline: toIsoDate(v.effectiveFrom) === BASELINE_DATE }));
  }

  async updateFacility(
    facilityId: string,
    patch: UpdateFacilityRequestType,
    userId?: string,
  ): Promise<FacilityResponseType> {
    await applyDueSettings(this.prisma, facilityId);
    const existing = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!existing) throw Errors.AUTH_INVALID('Facility not found');

    // The day the business settings in this save take effect. Never a past day: papers
    // already made were priced with what was in force then, and stay that way.
    const today = businessDate();
    const effectiveFrom = patch.effective_from ?? today;
    if (effectiveFrom < today) {
      throw Errors.VALIDATION_ERROR('A setting cannot take effect on a past date', 'effective_from');
    }
    // What will be in force on that day as things stand (a change already waiting included).
    const inForce = (await settingsOn(this.prisma, facilityId, effectiveFrom)) as unknown as Record<string, unknown>;
    const versions: Prisma.FacilitySettingVersionCreateManyInput[] = [];

    const data: Prisma.FacilityUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.address !== undefined) data.address = patch.address;
    if (patch.city !== undefined) data.city = patch.city;
    if (patch.phone !== undefined) data.phone = patch.phone;
    if (patch.gst_number !== undefined) data.gstNumber = patch.gst_number;
    if (patch.settings !== undefined) {
      const settingsPatch: Record<string, unknown> = { ...patch.settings };
      // Never allow internal keys through the generic settings PATCH.
      for (const key of INTERNAL_SETTINGS_KEYS) delete settingsPatch[key];

      // The fiscal-year start decides which past profits are "retained" and which
      // are "this year" on every balance sheet ever drawn. Once anything is posted,
      // changing it would restate them all silently (docs/25 L-05). Compared on the
      // resolved value, because a facility that never saved the key is still on the
      // default and has, in effect, already chosen it.
      const newFyStart = patch.settings.fiscal_year_start_month;
      if (
        newFyStart !== undefined &&
        newFyStart !== inForce['fiscal_year_start_month'] &&
        (await this.prisma.journalEntry.count({ where: { facilityId, postingStatus: 'POSTED' }, take: 1 })) > 0
      ) {
        throw Errors.VALIDATION_ERROR(
          'The fiscal year start cannot change once entries are posted: it would restate every past balance sheet',
          'settings.fiscal_year_start_month',
        );
      }

      // A charge priced per ton cannot be billed without a weight, so weights stay on screen while
      // one is active (docs/27). Compared on the resolved value: the Settings page sends every key.
      if (
        patch.settings.hide_weights === true &&
        !inForce['hide_weights'] &&
        (await this.prisma.serviceCharge.count({ where: { facilityId, isActive: true, unitType: 'PER_TON' } })) > 0
      ) {
        throw Errors.VALIDATION_ERROR(
          'Deactivate the service charges priced per ton first: they cannot be billed without a weight',
          'settings.hide_weights',
        );
      }

      // Monthly accrual is the policy from a fiscal-year boundary, applied
      // prospectively (docs/25 Q2, IFRS for SMEs s.10.12): a start mid-year, or in
      // a month already closed, would change figures that were already reported.
      const accrualStart = patch.settings.revenue_accrual?.start_date;
      if (accrualStart) {
        const fyMonth =
          patch.settings.fiscal_year_start_month ?? (inForce['fiscal_year_start_month'] as number);
        const start = fromIsoDate(accrualStart);
        if (toIsoDate(fiscalYearStart(start, fyMonth)) !== accrualStart) {
          throw Errors.VALIDATION_ERROR(
            'The accrual must start on the first day of a fiscal year',
            'settings.revenue_accrual.start_date',
          );
        }
        if (!(await new PeriodLockService(this.prisma).isOpen(this.prisma, facilityId, start))) {
          throw Errors.VALIDATION_ERROR(
            'The accrual cannot start in a closed period; choose the start of a fiscal year that is still open',
            'settings.revenue_accrual.start_date',
          );
        }
      }

      if (settingsPatch['email'] !== undefined) {
        const { smtp_password, ...emailPublic } = settingsPatch['email'] as Record<string, unknown> & {
          smtp_password?: string;
        };
        delete emailPublic[SMTP_PASSWORD_ENC_KEY];
        const existingEmail =
          existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
            ? ((existing.settings as Record<string, unknown>)['email'] as Record<string, unknown> | undefined)
            : undefined;
        // smtp_password is write-only: provided → encrypt and replace; omitted → keep existing.
        const passwordEnc =
          smtp_password !== undefined ? encryptSecret(smtp_password) : existingEmail?.[SMTP_PASSWORD_ENC_KEY];
        settingsPatch['email'] = passwordEnc ? { ...emailPublic, [SMTP_PASSWORD_ENC_KEY]: passwordEnc } : emailPublic;
      }

      // Each business setting that changes is saved as a dated version. One dated
      // today goes into the stored settings as well; one dated ahead waits.
      const known = new Set(
        (
          await this.prisma.facilitySettingVersion.findMany({ where: { facilityId }, distinct: ['key'], select: { key: true } })
        ).map((v) => v.key),
      );
      const now = new Date();
      for (const [key, value] of Object.entries(settingsPatch)) {
        if (value === undefined || UNDATED_SETTINGS_KEYS.includes(key)) continue;
        if (stable(value) === stable(inForce[key])) {
          delete settingsPatch[key];
          continue;
        }
        if (!known.has(key)) {
          const before = (resolveFacilitySettings(existing.settings) as unknown as Record<string, unknown>)[key];
          versions.push({
            facilityId,
            key,
            value: (before ?? null) as Prisma.InputJsonValue,
            effectiveFrom: fromIsoDate(BASELINE_DATE),
            note: 'Value before the first saved change',
            appliedAt: now,
          });
        }
        versions.push({
          facilityId,
          key,
          value: value as Prisma.InputJsonValue,
          effectiveFrom: fromIsoDate(effectiveFrom),
          note: patch.note ?? null,
          createdBy: userId ?? null,
          appliedAt: effectiveFrom <= today ? now : null,
        });
        if (effectiveFrom > today) delete settingsPatch[key];
      }

      data.settings = mergeSettings(
        existing.settings,
        settingsPatch as Partial<FacilitySettingsType>,
      ) as unknown as Prisma.InputJsonValue;
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.facility.update({ where: { id: facilityId }, data }),
      this.prisma.facilitySettingVersion.createMany({ data: versions }),
    ]);
    return format(updated, await this.pending(facilityId));
  }
}
