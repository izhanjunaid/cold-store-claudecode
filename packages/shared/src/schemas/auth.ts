import { z } from 'zod';
import { UserRole } from './enums';

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const LoginResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  // Set when the account has 2FA enabled but email is unconfigured/unreachable:
  // the login proceeds (an offline box must not lock out its owner) and the UI
  // surfaces a warning.
  two_factor_bypassed: z.boolean().optional(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: UserRole,
    facility_id: z.string().uuid(),
    permissions: z.array(z.string()).optional(),
  }),
});

// 2FA method: TOTP authenticator app (works fully offline, no bypass) or
// emailed codes (legacy — bypasses when the box cannot send email).
export const TwoFactorMethod = z.enum(['totp', 'email']);
export type TwoFactorMethodType = z.infer<typeof TwoFactorMethod>;

// Returned by POST /v1/auth/login instead of tokens when 2FA is required.
export const TwoFactorPendingResponse = z.object({
  requires_2fa: z.literal(true),
  method: TwoFactorMethod,
  pending_token: z.string(),
  message: z.string(),
});
export type TwoFactorPendingResponseType = z.infer<typeof TwoFactorPendingResponse>;

// 6-digit TOTP/email code, or an XXXX-XXXX backup code (TOTP accounts only).
export const Verify2faRequest = z.object({
  pending_token: z.string(),
  code: z
    .string()
    .regex(/^(\d{6}|[A-Za-z0-9]{4}[- ]?[A-Za-z0-9]{4})$/, 'Enter the 6-digit code or a backup code'),
});
export type Verify2faRequestType = z.infer<typeof Verify2faRequest>;

export const Enable2faRequest = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type Enable2faRequestType = z.infer<typeof Enable2faRequest>;

export const Disable2faRequest = z.object({
  password: z.string().min(8),
});
export type Disable2faRequestType = z.infer<typeof Disable2faRequest>;

// --- TOTP authenticator-app 2FA (Phase 18) ---

export const TotpSetupResponse = z.object({
  otpauth_uri: z.string(),
  secret: z.string(),
});
export type TotpSetupResponseType = z.infer<typeof TotpSetupResponse>;

export const TotpEnableRequest = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type TotpEnableRequestType = z.infer<typeof TotpEnableRequest>;

export const TotpEnableResponse = z.object({
  two_factor_enabled: z.literal(true),
  two_factor_method: z.literal('totp'),
  // Shown exactly once — stored only as sha256 hashes from here on.
  backup_codes: z.array(z.string()),
});
export type TotpEnableResponseType = z.infer<typeof TotpEnableResponse>;

export const TotpDisableRequest = z.object({
  password: z.string().min(8),
});
export type TotpDisableRequestType = z.infer<typeof TotpDisableRequest>;

export const RegenerateBackupCodesRequest = z.object({
  password: z.string().min(8),
});
export type RegenerateBackupCodesRequestType = z.infer<typeof RegenerateBackupCodesRequest>;

export const RegenerateBackupCodesResponse = z.object({
  backup_codes: z.array(z.string()),
});
export type RegenerateBackupCodesResponseType = z.infer<typeof RegenerateBackupCodesResponse>;

export const RefreshRequest = z.object({
  refresh_token: z.string(),
});

export const RefreshResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});

export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  name_urdu: z.string().nullable(),
  role: UserRole,
  facility_id: z.string().uuid(),
  two_factor_enabled: z.boolean(),
  two_factor_method: TwoFactorMethod.nullable(),
  backup_codes_remaining: z.number().int().nullable(),
  permissions: z.array(z.string()),
});

export const ForgotPasswordRequest = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequestType = z.infer<typeof ForgotPasswordRequest>;

export const ForgotPasswordResponse = z.object({
  message: z.string(),
});
export type ForgotPasswordResponseType = z.infer<typeof ForgotPasswordResponse>;

// Named to avoid clashing with users.ts ResetPasswordRequest (owner admin reset).
export const ResetPasswordWithOtpRequest = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  new_password: z.string().min(8),
});
export type ResetPasswordWithOtpRequestType = z.infer<typeof ResetPasswordWithOtpRequest>;
