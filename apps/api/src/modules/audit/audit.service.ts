import type { PrismaClient } from '@coldchain/db';
import type { AuditLogQueryType, AuditLogRowType } from '@coldchain/shared';

// Any key whose name mentions "password" carries a secret — a bcrypt hash
// (users.password_hash) or the encrypted SMTP app-password
// (settings.email.smtp_password_enc). Redact them so the activity log never
// surfaces credentials, even in ciphertext form.
const SENSITIVE_KEY = /password/i;

function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '***' : maskSensitive(v);
    }
    return out;
  }
  return value;
}

function maskJson(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object') return null;
  return maskSensitive(value) as Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    facilityId: string,
    query: AuditLogQueryType,
  ): Promise<{ data: AuditLogRowType[]; meta: { page: number; per_page: number; total: number } }> {
    const where: Record<string, unknown> = { facilityId };
    if (query.table_name) where['tableName'] = query.table_name;
    if (query.action) where['action'] = query.action;
    if (query.changed_by) where['changedBy'] = query.changed_by;
    if (query.record_id) where['recordId'] = query.record_id;
    if (query.date_from || query.date_to) {
      const changedAt: Record<string, Date> = {};
      if (query.date_from) changedAt['gte'] = new Date(`${query.date_from}T00:00:00.000Z`);
      if (query.date_to) changedAt['lte'] = new Date(`${query.date_to}T23:59:59.999Z`);
      where['changedAt'] = changedAt;
    }

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where: where as never }),
      this.prisma.auditLog.findMany({
        where: where as never,
        orderBy: { changedAt: 'desc' },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
      }),
    ]);

    // Batch-resolve actor ids → names in one query.
    const actorIds = [...new Set(rows.map((r) => r.changedBy))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(actors.map((a) => [a.id, a.name]));

    const data: AuditLogRowType[] = rows.map((r) => ({
      id: r.id,
      table_name: r.tableName,
      record_id: r.recordId,
      action: r.action,
      changed_by: r.changedBy,
      changed_by_name: nameById.get(r.changedBy) ?? null,
      changed_at: r.changedAt.toISOString(),
      old_values: maskJson(r.oldValues),
      new_values: maskJson(r.newValues),
      reason: r.reason,
    }));

    return { data, meta: { page: query.page, per_page: query.per_page, total } };
  }
}
