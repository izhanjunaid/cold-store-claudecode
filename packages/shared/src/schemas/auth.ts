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

// Returned by POST /v1/auth/login instead of tokens when 2FA is required.
export const TwoFactorPendingResponse = z.object({
  requires_2fa: z.literal(true),
  pending_token: z.string(),
  message: z.string(),
});
export type TwoFactorPendingResponseType = z.infer<typeof TwoFactorPendingResponse>;

export const Verify2faRequest = z.object({
  pending_token: z.string(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
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
