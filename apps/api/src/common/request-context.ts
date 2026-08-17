import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context for DB audit attribution. Populated by the
 * facility-scope plugin (facility from the X-Facility-ID header) and the
 * auth plugin (user + facility from the verified JWT). The patched
 * prisma.$transaction in facility-scope stamps these into transaction-local
 * GUCs (app.user_id / app.facility_id) that audit_trigger_fn reads.
 *
 * The previous mechanism — `SET LOCAL` issued as a standalone statement —
 * was a silent no-op: SET LOCAL outside a transaction block is discarded,
 * so every audit row attributed to the zero uuid (audit finding F-2b).
 */
export type RequestAuditContext = {
  userId?: string;
  facilityId?: string;
  /**
   * Interactive-transaction nesting depth, maintained by the patched
   * `$transaction` in the facility-scope plugin. The per-operation extension
   * checks it so it never tries to open a transaction inside one that already
   * stamped the settings.
   */
  depth?: number;
};

export const requestContext = new AsyncLocalStorage<RequestAuditContext>();
