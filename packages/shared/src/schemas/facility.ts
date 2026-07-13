import { z } from 'zod';

export const LatePaymentSurchargeRule = z.object({
  enabled: z.boolean(),
  pct_per_month: z.number().min(0).max(100),
  grace_days: z.number().int().min(0),
});
export type LatePaymentSurchargeRuleType = z.infer<typeof LatePaymentSurchargeRule>;

// Outbound email (SMTP) configuration. The SMTP password is write-only:
// it is accepted via EmailSettingsUpdate.smtp_password, stored encrypted under
// an internal `smtp_password_enc` key, and surfaced only as `smtp_password_set`.
export const EmailSettings = z.object({
  enabled: z.boolean(),
  smtp_host: z.string().min(1).max(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  smtp_user: z.string().max(200),
  from_name: z.string().max(100),
  admin_email: z.string().email().max(200).or(z.literal('')),
});
export type EmailSettingsType = z.infer<typeof EmailSettings>;

export const EmailSettingsUpdate = EmailSettings.extend({
  smtp_password: z.string().min(1).max(200).optional(),
});
export type EmailSettingsUpdateType = z.infer<typeof EmailSettingsUpdate>;

export const EmailSettingsResponse = EmailSettings.extend({
  smtp_password_set: z.boolean(),
});
export type EmailSettingsResponseType = z.infer<typeof EmailSettingsResponse>;

// Email notifications. The daily digest emails the facility admin a summary of
// overdue receivables, storage-capacity alerts and aging lots, once a day at
// digest_hour (facility-local, 0–23). Sending requires configured email.
export const NotificationSettings = z.object({
  daily_digest_enabled: z.boolean(),
  digest_hour: z.number().int().min(0).max(23),
});
export type NotificationSettingsType = z.infer<typeof NotificationSettings>;

export const FacilitySettings = z.object({
  weight_dispute_threshold_kg: z.number().nonnegative(),
  storage_alert_thresholds: z.record(z.string().uuid(), z.number().int().positive()),
  gst_registered: z.boolean(),
  number_format: z.enum(['en-PK', 'en-IN']),
  chamber_capacity_warning_pct: z.number().int().min(1).max(100),
  backdating_max_days: z.number().int().min(0).nullable(),
  gst_default_rate: z.number().min(0).max(100),
  late_payment_surcharge: LatePaymentSurchargeRule,
  email: EmailSettings,
  notifications: NotificationSettings,
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
  email: {
    enabled: false,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    from_name: 'ColdChain',
    admin_email: '',
  },
  notifications: {
    daily_digest_enabled: false,
    digest_hour: 8,
  },
};

export const UpdateFacilityRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().nullable().optional(),
  city: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).nullable().optional(),
  gst_number: z.string().max(50).nullable().optional(),
  settings: FacilitySettings.partial().extend({ email: EmailSettingsUpdate.optional() }).optional(),
});
export type UpdateFacilityRequestType = z.infer<typeof UpdateFacilityRequest>;

export const FacilityResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string(),
  phone: z.string().nullable(),
  gst_number: z.string().nullable(),
  settings: FacilitySettings.extend({ email: EmailSettingsResponse }),
});
export type FacilityResponseType = z.infer<typeof FacilityResponse>;

export const TestEmailRequest = z.object({
  to: z.string().email().optional(),
});
export type TestEmailRequestType = z.infer<typeof TestEmailRequest>;

export const TestEmailResponse = z.object({
  sent: z.boolean(),
  error: z.string().optional(),
});
export type TestEmailResponseType = z.infer<typeof TestEmailResponse>;
