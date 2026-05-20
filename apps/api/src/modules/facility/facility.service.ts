import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  DEFAULT_FACILITY_SETTINGS,
  type FacilitySettingsType,
  type UpdateFacilityRequestType,
  type FacilityResponseType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';

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
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    phone: row.phone,
    gst_number: row.gstNumber,
    settings: mergeSettings(row.settings, undefined),
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
      data.settings = mergeSettings(existing.settings, patch.settings) as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.facility.update({ where: { id: facilityId }, data });
    return format(updated);
  }
}
