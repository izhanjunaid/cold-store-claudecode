import { z } from 'zod';
import { GatePassDirection, GatePassStatus } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const vehicleNumber = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .transform((v) => v.toUpperCase());

export const LogInwardRequest = z.object({
  vehicle_number: vehicleNumber,
  driver_name: z.string().trim().min(1).max(100).optional(),
  driver_phone: z.string().trim().min(7).max(20).optional(),
  bilty_number: z.string().trim().min(1).max(50).optional(),
  party_id: z.string().uuid().optional(),
  declared_quantity: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type LogInwardRequestType = z.infer<typeof LogInwardRequest>;

export const LogOutwardRequest = z.object({
  vehicle_number: vehicleNumber,
  driver_name: z.string().trim().min(1).max(100).optional(),
  driver_phone: z.string().trim().min(7).max(20).optional(),
  outbound_event_id: z.string().uuid().optional(),
  declared_quantity: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type LogOutwardRequestType = z.infer<typeof LogOutwardRequest>;

export const LinkLotRequest = z.object({
  lot_id: z.string().uuid(),
});
export type LinkLotRequestType = z.infer<typeof LinkLotRequest>;

export const ClearOutwardRequest = z.object({
  outbound_event_id: z.string().uuid().optional(),
  credit_authorization: z.boolean().optional(),
  declared_quantity: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type ClearOutwardRequestType = z.infer<typeof ClearOutwardRequest>;

export const GatePassListQuery = z.object({
  status: GatePassStatus.optional(),
  direction: GatePassDirection.optional(),
  vehicle_number: z.string().trim().min(1).optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type GatePassListQueryType = z.infer<typeof GatePassListQuery>;

export const GatePassResponse = z.object({
  id: z.string().uuid(),
  pass_number: z.string(),
  direction: GatePassDirection,
  vehicle_number: z.string(),
  driver_name: z.string().nullable(),
  driver_phone: z.string().nullable(),
  bilty_number: z.string().nullable(),
  status: GatePassStatus,
  related_lot_id: z.string().uuid().nullable(),
  related_lot_number: z.string().nullable().optional(),
  related_outbound_id: z.string().uuid().nullable(),
  related_dispatch_note_number: z.string().nullable().optional(),
  related_commodity_name: z.string().nullable().optional(),
  related_unit_label: z.string().nullable().optional(),
  related_marka: z.string().nullable().optional(),
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().nullable().optional(),
  owner_party_name: z.string().nullable().optional(),
  declared_quantity: z.number().int().nullable(),
  authorized_quantity: z.number().int().nullable().optional(),
  quantity_mismatch_flag: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
  cleared_at: z.string().nullable(),
  turnaround_seconds: z.number().int().nullable(),
  created_by: z.string().uuid(),
});
export type GatePassResponseType = z.infer<typeof GatePassResponse>;
