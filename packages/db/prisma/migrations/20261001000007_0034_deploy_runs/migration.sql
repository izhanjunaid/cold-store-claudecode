-- 0034 — Every database update records how it ended (docs/25 §8, release blocker).
--
-- A failed update keeps the previous version running, and comparing the running
-- image's migrations with the database cannot tell: expand-only migrations may all
-- have applied before the failure (a chart-of-accounts collision fails after them).
-- deploy.ts writes one row per run; the settings screen shows the latest.
CREATE TABLE "deploy_runs" (
  "id"             SERIAL PRIMARY KEY,
  "target_version" VARCHAR(50) NOT NULL,
  "started_at"     TIMESTAMPTZ NOT NULL,
  "finished_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "succeeded"      BOOLEAN NOT NULL,
  "error"          TEXT
);
