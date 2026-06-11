import { z } from 'zod';

export const LatePaymentSurchargeRule = z.object({
  enabled: z.boolean(),
  pct_per_month: z.number().min(0).max(100),
  grace_days: z.number().int().min(0),
});
export type LatePaymentSurchargeRuleType = z.infer<typeof LatePaymentSurchargeRule>;

export const FacilitySettings = z.object({
  weight_dispute_threshold_kg: z.number().nonnegative(),
  storage_alert_thresholds: z.record(z.string().uuid(), z.number().int().positive()),
  gst_registered: z.boolean(),
  number_format: z.enum(['en-PK', 'en-IN']),
  chamber_capacity_warning_pct: z.number().int().min(1).max(100),
  backdating_max_days: z.number().int().min(0).nullable(),
  gst_default_rate: z.number().min(0).max(100),
  late_payment_surcharge: LatePaymentSurchargeRule,
});
export type FacilitySettingsType = z.infer<typeof FacilitySettings>;

export const DEFAULT_FACILITY_SETTINGS: FacilitySettingsType = {
  weight_dispute_threshold_kg: 5,
  storage_alert_thresholds: {},
  gst_registered: false,
  number_format: 'en-PK',
  chamber_capacity_warning_pct: 90,
  backdating_max_days: null,
  gst_default_rate: 18,
  late_payment_surcharge: { enabled: false, pct_per_month: 2, grace_days: 30 },
};

export const UpdateFacilityRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().nullable().optional(),
  city: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).nullable().optional(),
  gst_number: z.string().max(50).nullable().optional(),
  settings: FacilitySettings.partial().optional(),
});
export type UpdateFacilityRequestType = z.infer<typeof UpdateFacilityRequest>;

export const FacilityResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string(),
  phone: z.string().nullable(),
  gst_number: z.string().nullable(),
  settings: FacilitySettings,
});
export type FacilityResponseType = z.infer<typeof FacilityResponse>;
