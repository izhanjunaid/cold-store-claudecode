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
