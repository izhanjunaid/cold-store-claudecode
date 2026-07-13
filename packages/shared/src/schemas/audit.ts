import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// =====================================================================
// Phase 15 — Activity log (audit trail) viewer
// =====================================================================

export const AuditLogQuery = z.object({
  table_name: z.string().max(100).optional(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
  changed_by: z.string().uuid().optional(),
  record_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQueryType = z.infer<typeof AuditLogQuery>;

export interface AuditLogRowType {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_by: string;
  changed_by_name: string | null;
  changed_at: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
}
