-- Receipt numbers on payments (backlog P2-14).
--
-- Invoices are numbered and receipts were not, so a disputed cash receipt had
-- no number anyone could quote — only an internal uuid. Income Tax Ordinance
-- 2001 s.174 record-keeping wants better than that.
--
-- Deliberately NOT backfilled. A receipt number is issued when the receipt is
-- issued; stamping one onto a receipt the facility already handed over on
-- paper invents a document that never existed. Existing rows stay NULL and
-- read as "—". Postgres does not treat NULLs as conflicting, so the unique
-- index below holds regardless of how many there are.
ALTER TABLE "payments" ADD COLUMN "receipt_number" VARCHAR(20);

CREATE UNIQUE INDEX "payments_facility_id_receipt_number_key"
  ON "payments" ("facility_id", "receipt_number");
