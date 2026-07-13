-- ============================================================================
-- 0009 — Facility-scoped time index on the audit log (Phase 15)
--
-- The activity-log viewer pages the audit trail per facility, newest first.
-- The existing (changed_at) index isn't facility-scoped and the
-- (facility_id, table_name, record_id) index doesn't help time ordering, so
-- add a composite index tuned for that access pattern. Purely additive.
-- ============================================================================

-- CreateIndex
CREATE INDEX "audit_log_facility_id_changed_at_idx" ON "audit_log"("facility_id", "changed_at");
