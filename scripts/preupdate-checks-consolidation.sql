-- docs/25 §8 — Pre-update checks for the accounting consolidation release.
--
-- Run against a RESTORED COPY of the client backup, BEFORE the box takes the release:
--   psql -d <restored-db> -f preupdate-checks.sql
-- Read-only by construction. Every non-empty result is a case to correct THROUGH THE APP
-- (never by migration) — the correction is named under each check. Keep the output: once the
-- release repairs a defect, the evidence of how often it fired is gone.
SET default_transaction_read_only = on;
\pset pager off
\pset footer off

\echo '== C01 (R-01) parties whose AR is split across AR accounts — post a reclass JE per party BEFORE updating =='
SELECT p.name, p.party_type, l.account_code,
       round(sum(l.debit_amount - l.credit_amount), 2) AS balance_pkr
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.journal_entry_id AND e.posting_status = 'POSTED'
JOIN parties p ON p.id = l.party_id
WHERE l.account_code IN ('1110','1120','1130','1150')
  AND l.party_id IN (
    SELECT l2.party_id FROM journal_entry_lines l2
    JOIN journal_entries e2 ON e2.id = l2.journal_entry_id AND e2.posting_status = 'POSTED'
    WHERE l2.account_code IN ('1110','1120','1130','1150') AND l2.party_id IS NOT NULL
    GROUP BY l2.party_id HAVING count(DISTINCT l2.account_code) > 1)
GROUP BY p.name, p.party_type, l.account_code
ORDER BY p.name, l.account_code;

\echo '== C02 AR / peshgi / advance lines with no party — cannot reach any sub-ledger =='
SELECT e.entry_number, e.entry_date, e.source_table, l.account_code, l.debit_amount, l.credit_amount
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.journal_entry_id AND e.posting_status = 'POSTED'
WHERE l.account_code IN ('1110','1120','1130','1140','1150','2010') AND l.party_id IS NULL
ORDER BY e.entry_date;

\echo '== C03 (R-03) credit notes on GST invoices — output tax 2020 not reversed (pro-rata estimate) =='
SELECT cn.credit_note_number, cn.credit_date, i.invoice_number, i.total_pkr, i.gst_amount_pkr,
       cn.total_pkr AS credit_pkr,
       round(cn.total_pkr * i.gst_amount_pkr / nullif(i.total_pkr, 0), 2) AS gst_not_reversed_pkr
FROM credit_notes cn JOIN invoices i ON i.id = cn.original_invoice_id
WHERE i.gst_amount_pkr > 0
ORDER BY cn.credit_date;

\echo '== C04a (R-05) 1025 Cheques in Hand balance per book — negative means a cleared cheque was dishonoured =='
SELECT e.book_type, round(sum(l.debit_amount - l.credit_amount), 2) AS balance_1025
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.journal_entry_id AND e.posting_status = 'POSTED'
WHERE l.account_code = '1025'
GROUP BY e.book_type;

\echo '== C04b (R-05) dishonoured payments whose own entries leave 1025 non-zero =='
SELECT p.receipt_number, p.payment_date, p.amount_pkr, p.clearance_status,
       round(sum(l.debit_amount - l.credit_amount), 2) AS net_1025
FROM payments p
JOIN journal_entries e ON e.source_table = 'payments' AND e.source_id = p.id AND e.posting_status = 'POSTED'
JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '1025'
WHERE p.status = 'DISHONOURED'
GROUP BY p.id, p.receipt_number, p.payment_date, p.amount_pkr, p.clearance_status
HAVING abs(sum(l.debit_amount - l.credit_amount)) > 0.005;

\echo '== C05 (R-02) advances whose invoice allocations exceed their JE-04 postings — 2010 and AR overstated by the gap =='
SELECT * FROM (
  SELECT p.receipt_number, p.payment_date, p.amount_pkr,
    coalesce((SELECT sum(a.allocated_amount_pkr) FROM payment_allocations a
              WHERE a.payment_id = p.id AND a.invoice_id IS NOT NULL AND a.voided_at IS NULL), 0) AS allocated_pkr,
    coalesce((SELECT sum(l.debit_amount) FROM journal_entries e
              JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '2010'
              WHERE e.source_table = 'payments' AND e.source_id = p.id
                AND e.entry_type = 'ADVANCE_APPLIED' AND e.posting_status = 'POSTED'), 0) AS je04_pkr
  FROM payments p
  WHERE p.is_advance AND p.status <> 'DISHONOURED') x
WHERE abs(allocated_pkr - je04_pkr) > 0.005;

\echo '== C06 (L-03) reversed opening-balance entries — aging and party statements double-count their AR =='
SELECT entry_number, entry_date, created_at FROM journal_entries
WHERE source_table = 'opening_balances' AND reversed_by IS NOT NULL;

\echo '== C07 (C-15) reversed payroll runs that had been paid or remitted — reversal un-paid real cash =='
SELECT run_number, period_year, period_month, total_net_payable_pkr,
       payment_journal_entry_id IS NOT NULL AS was_paid,
       remittance_journal_entry_id IS NOT NULL AS was_remitted
FROM payroll_runs
WHERE status = 'REVERSED' AND (payment_journal_entry_id IS NOT NULL OR remittance_journal_entry_id IS NOT NULL);

\echo '== C08 (C-30) assets bought before go-live AND posted again by JE-12 — cost doubled =='
SELECT fa.asset_number, fa.asset_name, fa.asset_account_code, fa.purchase_date, fa.purchase_cost_pkr,
       ob.entry_date AS opening_balance_date
FROM fixed_assets fa
JOIN journal_entries ob ON ob.facility_id = fa.facility_id AND ob.source_table = 'opening_balances'
     AND ob.posting_status = 'POSTED' AND ob.reversed_by IS NULL
WHERE fa.purchase_journal_entry_id IS NOT NULL
  AND fa.purchase_date <= ob.entry_date
  AND EXISTS (SELECT 1 FROM journal_entry_lines l
              WHERE l.journal_entry_id = ob.id AND l.account_code = fa.asset_account_code AND l.debit_amount > 0);

\echo '== C09 (R-06) KATCHI invoices that charged GST =='
SELECT invoice_number, invoice_date, status, gst_amount_pkr FROM invoices
WHERE book_type = 'KATCHI' AND gst_amount_pkr > 0 AND status <> 'DRAFT';

\echo '== C10a (L-02) postings to 3030, or to an account whose code does not start with its class digit =='
SELECT c.account_code, c.account_name, c.account_class, count(l.id) AS lines,
       round(sum(l.debit_amount - l.credit_amount), 2) AS net_debit_pkr
FROM chart_of_accounts c
JOIN journal_entry_lines l ON l.facility_id = c.facility_id AND l.account_code = c.account_code
WHERE c.account_code = '3030'
   OR left(c.account_code, 1) <> CASE c.account_class
        WHEN 'ASSET' THEN '1' WHEN 'LIABILITY' THEN '2' WHEN 'EQUITY' THEN '3'
        WHEN 'REVENUE' THEN '4' WHEN 'COST_OF_SERVICE' THEN '5' WHEN 'EXPENSE' THEN '6' END
GROUP BY c.account_code, c.account_name, c.account_class;

\echo '== C10b (L-38) non-equity DETAIL accounts with no sectioned header — land in "unclassified" =='
SELECT c.account_code, c.account_name, c.account_class, c.parent_account_code
FROM chart_of_accounts c
LEFT JOIN chart_of_accounts h ON h.facility_id = c.facility_id AND h.account_code = c.parent_account_code
WHERE c.account_type = 'DETAIL' AND c.account_class <> 'EQUITY'
  AND (h.account_code IS NULL OR h.statement_section IS NULL);

\echo '== C11 (L-04) JE-25 accruals never reversed — revenue counted twice once the invoice lands =='
SELECT a.entry_number, a.entry_date FROM journal_entries a
WHERE a.source_table = 'revenue_accrual' AND a.entry_type = 'ACCRUAL' AND a.posting_status = 'POSTED'
  AND NOT EXISTS (SELECT 1 FROM journal_entries r
                  WHERE r.facility_id = a.facility_id AND r.source_table = 'revenue_accrual'
                    AND r.entry_type = 'ADJUSTMENT' AND r.posting_status = 'POSTED'
                    AND r.entry_date > a.entry_date);

\echo '== C12 (C-14) employee advances over-recovered below zero =='
SELECT advance_number, status, principal_pkr, balance_outstanding_pkr FROM employee_advances
WHERE balance_outstanding_pkr < 0;

\echo '== C13 (R-04) payments and credit notes on a different book than their invoice =='
SELECT 'payment' AS doc, p.receipt_number AS number, p.book_type AS doc_book, i.invoice_number, i.book_type AS invoice_book
FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id
WHERE a.voided_at IS NULL AND p.book_type <> i.book_type
UNION ALL
SELECT 'credit_note', cn.credit_note_number, cn.book_type, i.invoice_number, i.book_type
FROM credit_notes cn JOIN invoices i ON i.id = cn.original_invoice_id
WHERE cn.book_type <> i.book_type;

\echo '== C14 journal entries still carrying posting_status REVERSED (must be 0 before the CHECK validates) =='
SELECT count(*) AS reversed_status_rows FROM journal_entries WHERE posting_status = 'REVERSED';

\echo '== C15 (L-07) entries that point at their own original as "reversed by" (dishonour mirrors) =='
SELECT m.entry_number, m.entry_type, m.source_table, o.entry_number AS points_at
FROM journal_entries m JOIN journal_entries o ON o.id = m.reversed_by
WHERE o.reversed_by = m.id;

\echo '== C16 (L-05) fiscal_year_start_month changed after the first journal entry — past balance sheets restated =='
SELECT a.changed_at,
       a.old_values -> 'settings' ->> 'fiscal_year_start_month' AS old_fy_start,
       a.new_values -> 'settings' ->> 'fiscal_year_start_month' AS new_fy_start
FROM audit_log a
WHERE a.table_name = 'facilities'
  AND (a.old_values -> 'settings' ->> 'fiscal_year_start_month')
      IS DISTINCT FROM (a.new_values -> 'settings' ->> 'fiscal_year_start_month')
  AND a.changed_at > (SELECT min(je.created_at) FROM journal_entries je WHERE je.facility_id = a.facility_id);

\echo '== C17 earliest open period vs fiscal-year start — decides the accrual start date =='
SELECT f.name,
       coalesce((f.settings ->> 'fiscal_year_start_month')::int, 7) AS fy_start_month,
       (SELECT max(make_date(pl.period_year, pl.period_month, 1)) FROM period_locks pl
        WHERE pl.facility_id = f.id AND pl.unlocked_at IS NULL) AS last_locked_month
FROM facilities f;

\echo '== C18 accrued expense vouchers still open in 2040 — need "convert to bill" or legacy payment =='
SELECT voucher_number, voucher_date, vendor_name, amount_pkr FROM expense_vouchers
WHERE status = 'ACCRUED' ORDER BY voucher_date;

\echo '== C19 legacy JE-21 surcharges (no document behind them) =='
SELECT count(*) AS surcharges, coalesce(round(sum(l.debit_amount), 2), 0) AS ar_debited_pkr
FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.debit_amount > 0
WHERE e.source_table = 'invoice_surcharge' AND e.posting_status = 'POSTED';

\echo '== C20 owner-created accounts (review against the codes the new seed claims) =='
SELECT account_code, account_name, account_class, account_type, parent_account_code
FROM chart_of_accounts WHERE NOT is_system_account ORDER BY account_code;
