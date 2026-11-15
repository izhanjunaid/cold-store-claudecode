-- Season-sized generated data for timing runs (docs/31 "Measurements").
-- Run ONLY against a throwaway local database that already has migrations + seed:
--   psql -v ON_ERROR_STOP=1 -f scripts/perf-seed.sql <coldchain_perf url>
-- Makes 2,000 parties, 30,000 lots, 48,000 dispatched withdrawals each with a
-- finalized bill and journal entry, and cash receipts for 85% of the bills.
-- ponytail: rows are inserted directly, not through the API, so they carry no
-- rack placements or gate passes; add those if a timing needs them.
BEGIN;

CREATE TEMP TABLE k AS SELECT
  '00000000-0000-0000-0000-000000000001'::uuid AS fac,
  '00000000-0000-0000-0000-000000000010'::uuid AS usr,
  DATE '2025-12-01' AS d0;

INSERT INTO parties (id, facility_id, name, party_type, phone_primary, created_by, control_account_code)
SELECT md5('p'||i)::uuid, fac, 'Perf Party '||lpad(i::text, 4, '0'),
       (CASE WHEN i % 4 = 0 THEN 'TRADER' ELSE 'FARMER' END)::"PartyType",
       '0300'||lpad(i::text, 7, '0'), usr,
       CASE WHEN i % 4 = 0 THEN '1120' ELSE '1110' END
FROM generate_series(1, 2000) i, k;

CREATE TEMP TABLE l AS
SELECT j, md5('l'||j)::uuid AS id, md5('p'||(1 + j % 2000))::uuid AS party,
       (1 + j % 2000) % 4 = 0 AS trader, j % 3 = 0 AS apple,
       100 + j % 400 AS qty, d0 + (j % 90) AS inb, j % 5 = 0 AS stays
FROM generate_series(1, 30000) j, k;

INSERT INTO lots (id, facility_id, lot_number, chamber_id, owner_party_id, billing_party_id, commodity_id,
                  rate_plan_id, quantity_bags, current_balance_bags, accepted_weight_kg, inbound_date, entry_date,
                  marka, status, closed_at, created_by)
SELECT l.id, fac, 'LOT-PERF-'||lpad(j::text, 6, '0'),
       ('00000000-0000-0000-0000-00000000030'||(j % 4))::uuid, party, party,
       (CASE WHEN apple THEN '00000000-0000-0000-0000-000000000101' ELSE '00000000-0000-0000-0000-000000000100' END)::uuid,
       (CASE WHEN apple THEN '00000000-0000-0000-0000-000000000551' ELSE '00000000-0000-0000-0000-000000000550' END)::uuid,
       qty, CASE WHEN stays THEN qty ELSE 0 END, 0, inb, inb, 'M'||(j % 500),
       (CASE WHEN stays THEN 'ACTIVE' ELSE 'CLOSED' END)::"LotStatus",
       CASE WHEN stays THEN NULL ELSE inb + 180 + j % 60 END, usr
FROM l, k;

INSERT INTO ownership_history (id, lot_id, event_type, to_party_id, quantity_bags, effective_date, operator_id)
SELECT md5('h'||j)::uuid, l.id, 'INITIAL', party, qty, inb, usr FROM l, k;

-- Two withdrawals per lot that leaves: half, then the rest.
CREATE TEMP TABLE w AS
SELECT row_number() OVER (ORDER BY j, n) AS s, md5('w'||j||'-'||n)::uuid AS wid, l.*, n,
       CASE WHEN n = 1 THEN qty / 2 ELSE qty - qty / 2 END AS bags,
       inb + (CASE WHEN n = 1 THEN 120 ELSE 180 END) + j % 60 AS dt
FROM l, generate_series(1, 2) n WHERE NOT stays;

INSERT INTO outbound_events (id, lot_id, facility_id, withdrawal_type, quantity_withdrawn_bags, outbound_date,
                             owner_party_id_snapshot, vehicle_number, dispatch_note_number, status,
                             created_by, finalized_at, finalized_by)
SELECT wid, md5('l'||j)::uuid, fac, (CASE WHEN n = 2 THEN 'FULL' ELSE 'PARTIAL' END)::"WithdrawalType", bags, dt,
       party, 'LEA-'||(s % 9000), 'DN-PERF-'||lpad(s::text, 6, '0'), 'DISPATCHED', usr, dt, usr
FROM w, k;

-- One finalized bill + balanced entry per withdrawal (Dr receivable, Cr storage revenue).
INSERT INTO journal_entries (id, facility_id, entry_number, entry_date, entry_type, source_table, source_id,
                             description, period_month, period_year, created_by)
SELECT md5('ji'||s)::uuid, fac, 'JE-PERF-I'||lpad(s::text, 6, '0'), dt, 'INVOICE', 'invoices', md5('i'||s)::uuid,
       'Perf invoice', extract(month FROM dt)::int, extract(year FROM dt)::int, usr
FROM w, k;

INSERT INTO journal_entry_lines (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount, party_id, lot_id)
SELECT md5('jil'||s||'-'||ln)::uuid, md5('ji'||s)::uuid, ln,
       CASE WHEN ln = 1 THEN (CASE WHEN trader THEN '1120' ELSE '1110' END) ELSE (CASE WHEN apple THEN '4020' ELSE '4010' END) END,
       fac, CASE WHEN ln = 1 THEN bags * 250 ELSE 0 END, CASE WHEN ln = 2 THEN bags * 250 ELSE 0 END,
       CASE WHEN ln = 1 THEN party END, md5('l'||j)::uuid
FROM w, generate_series(1, 2) ln, k;

INSERT INTO invoices (id, facility_id, invoice_number, lot_id, outbound_event_id, billing_party_id, invoice_date,
                      period_start, period_end, sub_total_pkr, total_pkr, amount_paid_pkr, status, finalized_at,
                      finalized_by, journal_entry_id, created_by)
SELECT md5('i'||s)::uuid, fac, 'INV-PERF-'||lpad(s::text, 6, '0'), md5('l'||j)::uuid, wid, party, dt, inb, dt,
       bags * 250, bags * 250, CASE WHEN s % 20 < 17 THEN bags * 250 ELSE 0 END, 'FINALIZED', dt, usr,
       md5('ji'||s)::uuid, usr
FROM w, k;

INSERT INTO invoice_line_items (id, invoice_id, line_type, description, quantity, unit_price_pkr, amount_pkr, rate_plan_id)
SELECT md5('il'||s)::uuid, md5('i'||s)::uuid, 'STORAGE', 'Storage — '||bags||' bags', bags, 250, bags * 250,
       (CASE WHEN apple THEN '00000000-0000-0000-0000-000000000551' ELSE '00000000-0000-0000-0000-000000000550' END)::uuid
FROM w;

-- Cash receipts for 85% of the bills (Dr cash, Cr receivable).
CREATE TEMP TABLE pay AS SELECT * FROM w WHERE s % 20 < 17;

INSERT INTO journal_entries (id, facility_id, entry_number, entry_date, entry_type, source_table, source_id,
                             description, period_month, period_year, created_by)
SELECT md5('jp'||s)::uuid, fac, 'JE-PERF-P'||lpad(s::text, 6, '0'), dt, 'PAYMENT', 'payments', md5('y'||s)::uuid,
       'Perf receipt', extract(month FROM dt)::int, extract(year FROM dt)::int, usr
FROM pay, k;

INSERT INTO journal_entry_lines (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount, party_id)
SELECT md5('jpl'||s||'-'||ln)::uuid, md5('jp'||s)::uuid, ln,
       CASE WHEN ln = 1 THEN '1010' ELSE (CASE WHEN trader THEN '1120' ELSE '1110' END) END,
       fac, CASE WHEN ln = 1 THEN bags * 250 ELSE 0 END, CASE WHEN ln = 2 THEN bags * 250 ELSE 0 END,
       CASE WHEN ln = 2 THEN party END
FROM pay, generate_series(1, 2) ln, k;

INSERT INTO payments (id, facility_id, party_id, payment_date, amount_pkr, payment_method, status, asset_account_code,
                      journal_entry_id, created_by, receipt_number)
SELECT md5('y'||s)::uuid, fac, party, dt, bags * 250, 'CASH', 'ALLOCATED', '1010', md5('jp'||s)::uuid, usr,
       'RCP-PERF-'||lpad(s::text, 6, '0')
FROM pay, k;

INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_amount_pkr)
SELECT md5('a'||s)::uuid, md5('y'||s)::uuid, md5('i'||s)::uuid, bags * 250 FROM pay;

COMMIT;
ANALYZE;
