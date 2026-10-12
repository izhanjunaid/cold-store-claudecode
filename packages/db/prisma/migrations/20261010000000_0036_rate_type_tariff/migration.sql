-- 0036 — A rate plan can bill on a stepped tariff (half month, months, days; calendar
-- split month; season fee + extension). The tariff itself is 0037.
--
-- Alone in its file: PostgreSQL refuses to use an enum value in the transaction that
-- adds it, and 0037's constraint names it.
ALTER TYPE "RateType" ADD VALUE IF NOT EXISTS 'TARIFF_PER_BAG';
