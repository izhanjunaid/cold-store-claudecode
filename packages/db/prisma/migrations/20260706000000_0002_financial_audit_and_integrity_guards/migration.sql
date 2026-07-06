-- ============================================================================
-- 0002 — Financial audit coverage + DB-level integrity guards
--
-- Implements the priority-1 fixes from docs/16_accounting_module_audit.md:
--   F-1   audit triggers on all financial tables (was: users + facilities only)
--         + DELETE added to AuditAction (row deletions were unloggable)
--   F-2a  audit_log made append-only at the trigger level
--   F-3   posted journal entries + lines immutable except POSTED -> REVERSED;
--         deferred SUM(debit) = SUM(credit) constraint per entry;
--         per-line CHECK constraints; account-code FK no longer cascades
--   F-4.3 period_locks rows cannot be deleted; lock/unlock overwrites are
--         captured by the audit trigger (old/new values)
--   F-12b chart_of_accounts structural fields locked once the account has
--         journal postings ("locked once used")
--
-- financial_guards_set(bool) toggles the triggers for the test harness's
-- cleanup path (integration suites and /v1/_test/reset legitimately purge
-- fixture data). Production hardening: run the app under a non-owner role
-- and REVOKE EXECUTE ON FUNCTION financial_guards_set FROM that role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- AuditAction gains DELETE; audit_log.new_values becomes nullable (a DELETE
-- audit row has old_values only).
-- ---------------------------------------------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETE';

ALTER TABLE "audit_log" ALTER COLUMN "new_values" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- audit_trigger_fn rewritten to:
--   * handle DELETE (logs old_values, null new_values)
--   * read facility_id/id via jsonb so it attaches to tables without a
--     facility_id column
--   * for tables without facility_id, resolve it through a parent table
--     passed as trigger arguments: audit_trigger_fn('<parent_table>',
--     '<fk_column>') — audit_log.facility_id has a FOREIGN KEY to
--     facilities, so it must always resolve to a real facility
-- Existing triggers (audit_users, audit_facilities) keep working unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_facility_id uuid;
  v_raw text;
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
BEGIN
  v_raw := current_setting('app.user_id', true);
  IF v_raw IS NOT NULL AND v_raw <> '' THEN
    v_user_id := v_raw::uuid;
  ELSE
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_row := v_old;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
  ELSE
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_row := v_new;
  END IF;

  v_facility_id := (v_row ->> 'facility_id')::uuid;

  IF v_facility_id IS NULL AND TG_NARGS >= 2 THEN
    EXECUTE format('SELECT facility_id FROM %I WHERE id = $1', TG_ARGV[0])
      INTO v_facility_id
      USING (v_row ->> TG_ARGV[1])::uuid;
  END IF;

  IF v_facility_id IS NULL THEN
    v_raw := current_setting('app.facility_id', true);
    IF v_raw IS NOT NULL AND v_raw <> '' THEN
      v_facility_id := v_raw::uuid;
    ELSE
      v_facility_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;
  END IF;

  INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
  VALUES (gen_random_uuid(), v_facility_id, TG_TABLE_NAME, (v_row ->> 'id')::uuid, TG_OP::"AuditAction", v_user_id, NOW(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit triggers on the financial tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER audit_chart_of_accounts
  AFTER INSERT OR UPDATE OR DELETE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entries
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entry_lines
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_period_locks
  AFTER INSERT OR UPDATE OR DELETE ON period_locks
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payment_allocations
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn('payments', 'payment_id');
CREATE OR REPLACE TRIGGER audit_credit_notes
  AFTER INSERT OR UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_expense_vouchers
  AFTER INSERT OR UPDATE OR DELETE ON expense_vouchers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_party_loans
  AFTER INSERT OR UPDATE OR DELETE ON party_loans
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_party_loan_repayments
  AFTER INSERT OR UPDATE OR DELETE ON party_loan_repayments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn('party_loans', 'loan_id');

-- ---------------------------------------------------------------------------
-- audit_log is append-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_audit_log_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE OR REPLACE TRIGGER guard_audit_log
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION guard_audit_log_fn();

-- ---------------------------------------------------------------------------
-- Journal entries: immutable once posted. Allowed transitions only:
--   * AUTO_DRAFT rows may be updated or deleted freely (incl. promotion to
--     POSTED via the draft-post endpoint)
--   * POSTED -> REVERSED, setting reversed_by, with no other column changing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_journal_entries_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posting_status = 'AUTO_DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'journal entry % cannot be deleted once posted (post a reversal entry instead)', OLD.entry_number;
  END IF;

  IF OLD.posting_status = 'AUTO_DRAFT' THEN
    RETURN NEW;
  END IF;

  IF OLD.posting_status = 'POSTED'
     AND NEW.posting_status = 'REVERSED'
     AND NEW.reversed_by IS NOT NULL
     AND (to_jsonb(OLD) - 'posting_status' - 'reversed_by') = (to_jsonb(NEW) - 'posting_status' - 'reversed_by') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'journal entry % is immutable once posted (corrections require a reversal entry)', OLD.entry_number;
END;
$$;

CREATE OR REPLACE TRIGGER guard_journal_entries
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_journal_entries_fn();

-- ---------------------------------------------------------------------------
-- Journal entry lines: frozen with their entry. Lines of an AUTO_DRAFT entry
-- are freely mutable; lines of a POSTED/REVERSED entry accept no UPDATE,
-- DELETE, or late INSERT. Inserts in the same transaction that created the
-- entry (the posting path inserts the entry, then its lines) are recognised
-- via xmin. A missing parent means the entry was deleted earlier in this
-- transaction after passing its own guard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_journal_entry_lines_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_xmin xid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT posting_status::text INTO v_status FROM journal_entries WHERE id = OLD.journal_entry_id;
    IF v_status IS NULL OR v_status = 'AUTO_DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'journal entry lines are immutable once the entry is posted';
  END IF;

  SELECT posting_status::text, xmin INTO v_status, v_xmin
  FROM journal_entries WHERE id = NEW.journal_entry_id;

  IF v_status IS NULL OR v_status = 'AUTO_DRAFT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND v_xmin::text::bigint = (txid_current() % 4294967296) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'journal entry lines are immutable once the entry is posted';
END;
$$;

CREATE OR REPLACE TRIGGER guard_journal_entry_lines
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION guard_journal_entry_lines_fn();

-- ---------------------------------------------------------------------------
-- Double-entry balance: SUM(debit) = SUM(credit) per entry, checked at commit
-- (the spec's promised "second line of defense", 09_accounting_spec §645).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_journal_entry_balanced_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_entry) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_debit, v_credit
  FROM journal_entry_lines WHERE journal_entry_id = v_entry;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits % <> credits %', v_entry, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS guard_journal_entry_balanced ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER guard_journal_entry_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balanced_fn();

-- Per-line sanity, mirroring the application checks in postInTransaction.
ALTER TABLE journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_non_negative;
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_non_negative CHECK (debit_amount >= 0 AND credit_amount >= 0);
ALTER TABLE journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_single_side;
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_single_side CHECK (NOT (debit_amount > 0 AND credit_amount > 0));
ALTER TABLE journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_non_zero;
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_non_zero CHECK (debit_amount + credit_amount > 0);

-- A direct-DB account renumber must not silently rewrite history.
ALTER TABLE journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_facility_id_account_code_fkey;
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_facility_id_account_code_fkey
  FOREIGN KEY (facility_id, account_code)
  REFERENCES chart_of_accounts(facility_id, account_code)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Chart of accounts: structural fields locked once the account has postings.
-- Name and is_active stay editable; historical statements classify by the
-- live class/type/parent, so those must not move under posted balances.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_chart_of_accounts_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.account_code IS DISTINCT FROM OLD.account_code
      OR NEW.account_class IS DISTINCT FROM OLD.account_class
      OR NEW.account_type IS DISTINCT FROM OLD.account_type
      OR NEW.parent_account_code IS DISTINCT FROM OLD.parent_account_code
      OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance)
     AND EXISTS (
       SELECT 1 FROM journal_entry_lines l
       WHERE l.facility_id = OLD.facility_id AND l.account_code = OLD.account_code
     ) THEN
    RAISE EXCEPTION 'account % structure is locked: it has journal postings (create a new account and reclassify instead)', OLD.account_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER guard_chart_of_accounts
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_chart_of_accounts_fn();

-- ---------------------------------------------------------------------------
-- Period locks: rows are history, not scratch state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_period_locks_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'period locks cannot be deleted';
END;
$$;

CREATE OR REPLACE TRIGGER guard_period_locks
  BEFORE DELETE ON period_locks
  FOR EACH ROW EXECUTE FUNCTION guard_period_locks_fn();

-- ---------------------------------------------------------------------------
-- Test-harness toggle. Disables/enables every audit_* and guard_* trigger on
-- the financial tables so fixture cleanup can purge rows. NOT for
-- application code. Production: REVOKE EXECUTE from the runtime role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION financial_guards_set(p_enabled boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  v_mode text := CASE WHEN p_enabled THEN 'ENABLE' ELSE 'DISABLE' END;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name, g.tgname
    FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid
    WHERE NOT g.tgisinternal
      AND (g.tgname LIKE 'guard\_%' OR g.tgname LIKE 'audit\_%')
      AND c.relname IN ('chart_of_accounts', 'journal_entries', 'journal_entry_lines',
                        'period_locks', 'invoices', 'payments', 'payment_allocations',
                        'credit_notes', 'expense_vouchers', 'party_loans',
                        'party_loan_repayments', 'audit_log')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;
