import { z } from 'zod';

export const UuidParam = z.object({
  id: z.string().uuid(),
});

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

export const DateRangeQuery = z.object({
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
});

export const FacilityHeader = z.object({
  'x-facility-id': z.string().uuid(),
});

export function successResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z
      .object({
        page: z.number(),
        per_page: z.number(),
        total: z.number(),
      })
      .optional(),
  });
}

export const ErrorResponse = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
});
