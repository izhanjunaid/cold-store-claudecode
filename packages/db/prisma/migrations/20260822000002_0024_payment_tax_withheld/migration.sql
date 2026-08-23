-- Tax withheld from the facility on customer receipts (Income Tax Ordinance
-- 2001 s.153; backlog P3-6).
--
-- A customer paying for storage deducts tax at source and pays the balance.
-- That deduction is an advance of the FACILITY's own income tax, not a
-- discount — but with nowhere to record it, the invoice looked part-unpaid
-- forever and the money simply vanished into an unexplained AR shortfall.
--
-- Stored on the row, not merely accepted in the request: the cheque-clearing
-- (JE-24) and cheque-dishonour (JE-06) entries fire days or weeks later and
-- both need to know that the cash leg was net while AR was settled gross.
ALTER TABLE "payments"
  ADD COLUMN "tax_withheld_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0;
