import { z } from 'zod';
import { UserRole } from './enums';

export const UserListQuery = z.object({
  role: UserRole.optional(),
  is_active: z.coerce.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});
export type UserListQueryType = z.infer<typeof UserListQuery>;

export const CreateUserRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  name_urdu: z.string().max(200).nullable().optional(),
  role: UserRole,
  initial_password: z.string().min(8),
});
export type CreateUserRequestType = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  name_urdu: z.string().max(200).nullable().optional(),
  role: UserRole.optional(),
  is_active: z.boolean().optional(),
});
export type UpdateUserRequestType = z.infer<typeof UpdateUserRequest>;

export const ResetPasswordRequest = z.object({
  new_password: z.string().min(8),
});
export type ResetPasswordRequestType = z.infer<typeof ResetPasswordRequest>;

export const ChangePasswordRequest = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});
export type ChangePasswordRequestType = z.infer<typeof ChangePasswordRequest>;

export const UserResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  name_urdu: z.string().nullable(),
  role: UserRole,
  is_active: z.boolean(),
  must_change_password: z.boolean(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
});
export type UserResponseType = z.infer<typeof UserResponse>;
