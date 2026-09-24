-- 0026: an owner of the facility becomes a record, not an inference.
--
-- Until now the statements worked out whose an equity account was by reading its
-- normal balance: DEBIT meant drawings, CREDIT meant capital. Nothing linked one
-- owner's two accounts and nothing knew a partner needed both, so a live chart
-- could hold — and did hold — an owner with a drawings account, no capital
-- account, and no way to notice.

CREATE TABLE "partners" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"           UUID NOT NULL REFERENCES "facilities"("id"),
  "name"                  VARCHAR(200) NOT NULL,
  "capital_account_code"  VARCHAR(10) NOT NULL,
  "drawings_account_code" VARCHAR(10) NOT NULL,
  "admitted_on"           DATE NOT NULL,
  "retired_on"            DATE,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One account belongs to one partner. Without these two, a second partner could
-- claim an account already in use and every per-owner figure would double-count.
CREATE UNIQUE INDEX "partners_facility_capital_key"  ON "partners" ("facility_id", "capital_account_code");
CREATE UNIQUE INDEX "partners_facility_drawings_key" ON "partners" ("facility_id", "drawings_account_code");
CREATE UNIQUE INDEX "partners_facility_name_key"     ON "partners" ("facility_id", "name");

-- A partner's accounts must exist in the chart, and must keep existing: the
-- statements resolve every per-owner figure through these codes, so an account
-- deleted out from under a partner would silently drop them from the equity
-- section. chart_of_accounts is keyed (facility_id, account_code).
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_capital_account_fkey"
  FOREIGN KEY ("facility_id", "capital_account_code")
  REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_drawings_account_fkey"
  FOREIGN KEY ("facility_id", "drawings_account_code")
  REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT;

-- The two accounts are different accounts. Cheap to state, and the failure it
-- prevents (both sides of an owner's equity in one place) is silent.
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_accounts_distinct"
  CHECK ("capital_account_code" <> "drawings_account_code");

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_retired_after_admitted"
  CHECK ("retired_on" IS NULL OR "retired_on" >= "admitted_on");


CREATE TABLE "partner_profit_shares" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"    UUID NOT NULL REFERENCES "facilities"("id"),
  "partner_id"     UUID NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "effective_from" DATE NOT NULL,
  -- A relative weight, not a percentage: the allocator normalises over the
  -- partners effective on the date, so a set of weights can never fail to add
  -- up to a whole.
  "weight"         DECIMAL(12,4) NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "partner_profit_shares_weight_positive" CHECK ("weight" > 0)
);

CREATE UNIQUE INDEX "partner_profit_shares_partner_date_key" ON "partner_profit_shares" ("partner_id", "effective_from");
CREATE INDEX "partner_profit_shares_facility_date_idx" ON "partner_profit_shares" ("facility_id", "effective_from");
