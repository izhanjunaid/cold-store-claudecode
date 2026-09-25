-- 0027 — Enum values for the accounting consolidation (docs/25).
--
-- Alone in this file on purpose: PostgreSQL refuses to USE an enum value in the
-- transaction that adds it, and every later migration in this release does use
-- them. Several ADD VALUEs of the same enum in one transaction are fine.

-- A supplier is a party: payables get the same per-party control account and the
-- same sub-ledger as receivables (docs/25 C-01).
ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'SUPPLIER';

-- Entry types that used to be filed as ADJUSTMENT or EXPENSE, which made the type
-- carry no meaning (docs/25 L-10, C-45).
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'OWNER_EQUITY';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'CASH_TRANSFER';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'IMPAIRMENT';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'BILL';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'TAX_REMITTANCE';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'LATE_PAYMENT_SURCHARGE';

-- A late-payment surcharge becomes a document line, so it can be allocated,
-- credited, written off and voided like any other charge (docs/25 R-08).
ALTER TYPE "InvoiceLineType" ADD VALUE IF NOT EXISTS 'SURCHARGE';

-- An accrued expense voucher converted into a supplier bill (docs/25 C-03).
ALTER TYPE "ExpenseVoucherStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';
