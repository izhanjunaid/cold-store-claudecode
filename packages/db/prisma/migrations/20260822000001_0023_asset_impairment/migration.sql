-- Impairment of fixed assets (IFRS for SMEs Section 27; backlog P2-7, narrow slice).
--
-- Section 27 requires an impairment assessment at each reporting date and
-- there was no mechanism at all. A failed compressor or a flood-damaged
-- building is a realistic indicator for a cold store.
--
-- Kept separate from accumulated_depreciation_pkr: without this column the
-- loss would exist only in the GL with nothing on the asset register tying to
-- it, and carrying amount on the register would be overstated by the whole
-- write-down.
ALTER TABLE "fixed_assets"
  ADD COLUMN "accumulated_impairment_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0;
