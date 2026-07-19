import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  DEFAULT_FACILITY_SETTINGS,
  type FacilitySettingsType,
  type UpdateFacilityRequestType,
  type FacilityResponseType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { encryptSecret } from '../../common/crypto';

// Top-level settings keys that are managed by dedicated endpoints and must never
// appear in facility responses or be writable through PATCH /v1/facilities/me
// (they live in the same JSON column so the facilities audit trigger covers them).
const INTERNAL_SETTINGS_KEYS = ['permissions', 'notifications_state'];

// Internal keys inside settings.email holding aes-256-gcm encrypted secrets:
// the SMTP password (legacy provider) and the email API key (Brevo).
const SMTP_PASSWORD_ENC_KEY = 'smtp_password_enc';
const API_KEY_ENC_KEY = 'api_key_enc';

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

function format(row: {
  id: string;
  name: string;
  address: string | null;
  city: string;
  phone: string | null;
  gstNumber: string | null;
  settings: Prisma.JsonValue;
}): FacilityResponseType {
  const merged = mergeSettings(row.settings, undefined) as unknown as Record<string, unknown>;
  for (const key of INTERNAL_SETTINGS_KEYS) delete merged[key];

  // The stored email object may carry encrypted secrets — strip them and
  // expose only whether each is set.
  const emailStored = (merged['email'] as Record<string, unknown> | undefined) ?? {};
  const emailRaw: Record<string, unknown> = { ...DEFAULT_FACILITY_SETTINGS.email, ...emailStored };
  const passwordSet = Boolean(emailRaw[SMTP_PASSWORD_ENC_KEY]);
  const apiKeySet = Boolean(emailRaw[API_KEY_ENC_KEY]);
  delete emailRaw[SMTP_PASSWORD_ENC_KEY];
  delete emailRaw[API_KEY_ENC_KEY];
  merged['email'] = { ...emailRaw, smtp_password_set: passwordSet, api_key_set: apiKeySet };

  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    phone: row.phone,
    gst_number: row.gstNumber,
    settings: merged as unknown as FacilityResponseType['settings'],
  };
}

export class FacilityService {
  constructor(private prisma: PrismaClient) {}

  async getFacility(facilityId: string): Promise<FacilityResponseType> {
    const row = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!row) throw Errors.AUTH_INVALID('Facility not found');
    return format(row);
  }

  async updateFacility(
    facilityId: string,
    patch: UpdateFacilityRequestType,
  ): Promise<FacilityResponseType> {
    const existing = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!existing) throw Errors.AUTH_INVALID('Facility not found');

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

      if (settingsPatch['email'] !== undefined) {
        const { smtp_password, api_key, ...emailPublic } = settingsPatch['email'] as Record<string, unknown> & {
          smtp_password?: string;
          api_key?: string;
        };
        delete emailPublic[SMTP_PASSWORD_ENC_KEY];
        delete emailPublic[API_KEY_ENC_KEY];
        const existingEmail =
          existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
            ? ((existing.settings as Record<string, unknown>)['email'] as Record<string, unknown> | undefined)
            : undefined;
        // Secrets are write-only: provided → encrypt and replace; omitted → keep existing.
        const passwordEnc =
          smtp_password !== undefined ? encryptSecret(smtp_password) : existingEmail?.[SMTP_PASSWORD_ENC_KEY];
        const apiKeyEnc = api_key !== undefined ? encryptSecret(api_key) : existingEmail?.[API_KEY_ENC_KEY];
        settingsPatch['email'] = {
          ...emailPublic,
          ...(passwordEnc ? { [SMTP_PASSWORD_ENC_KEY]: passwordEnc } : {}),
          ...(apiKeyEnc ? { [API_KEY_ENC_KEY]: apiKeyEnc } : {}),
        };
      }

      data.settings = mergeSettings(
        existing.settings,
        settingsPatch as Partial<FacilitySettingsType>,
      ) as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.facility.update({ where: { id: facilityId }, data });
    return format(updated);
  }
}
