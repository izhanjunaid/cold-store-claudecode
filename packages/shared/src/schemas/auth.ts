import { z } from 'zod';
import { UserRole } from './enums';

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const LoginResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: UserRole,
    facility_id: z.string().uuid(),
  }),
});

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
