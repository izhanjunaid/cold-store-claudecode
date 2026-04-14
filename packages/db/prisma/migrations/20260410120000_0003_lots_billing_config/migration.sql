-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('SEASONAL_PER_BAG', 'MONTHLY_PER_BAG', 'DAILY_PER_BAG');

-- CreateEnum
CREATE TYPE "ServiceUnitType" AS ENUM ('PER_BAG', 'PER_TON', 'FLAT');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'CLOSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BookType" AS ENUM ('PACCI', 'KATCHI');

-- CreateEnum
CREATE TYPE "OwnershipEventType" AS ENUM ('INITIAL', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "commodity_id" UUID,
    "rate_type" "RateType" NOT NULL,
    "rate_amount_pkr" DECIMAL(10,2) NOT NULL,
    "season_start_date" DATE,
    "season_end_date" DATE,
    "min_billing_days" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_charges" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit_type" "ServiceUnitType" NOT NULL,
    "unit_price_pkr" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "lot_number" VARCHAR(30) NOT NULL,
    "chamber_id" UUID NOT NULL,
    "owner_party_id" UUID NOT NULL,
    "billing_party_id" UUID NOT NULL,
    "commodity_id" UUID NOT NULL,
    "variety_id" UUID,
    "rate_plan_id" UUID NOT NULL,
    "quantity_bags" INTEGER NOT NULL,
    "current_balance_bags" INTEGER NOT NULL,
    "accepted_weight_kg" DECIMAL(10,2) NOT NULL,
    "declared_weight_kg" DECIMAL(10,2),
    "weight_dispute_flag" BOOLEAN NOT NULL DEFAULT false,
    "weight_dispute_note" TEXT,
    "quality_grade_inbound" VARCHAR(2),
    "inbound_date" DATE NOT NULL,
    "entry_date" DATE NOT NULL,
    "parent_lot_id" UUID,
    "vehicle_number" VARCHAR(20),
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "closed_at" DATE,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_history" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "event_type" "OwnershipEventType" NOT NULL,
    "from_party_id" UUID,
    "to_party_id" UUID NOT NULL,
    "quantity_bags" INTEGER NOT NULL,
    "transfer_price_pkr" DECIMAL(12,2),
    "effective_date" DATE NOT NULL,
    "operator_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_plans_facility_id_is_active_idx" ON "rate_plans"("facility_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "service_charges_facility_id_name_key" ON "service_charges"("facility_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lots_facility_id_lot_number_key" ON "lots"("facility_id", "lot_number");

-- CreateIndex
CREATE INDEX "lots_facility_id_status_idx" ON "lots"("facility_id", "status");

-- CreateIndex
CREATE INDEX "lots_owner_party_id_status_idx" ON "lots"("owner_party_id", "status");

-- CreateIndex
CREATE INDEX "lots_chamber_id_status_idx" ON "lots"("chamber_id", "status");

-- CreateIndex
CREATE INDEX "lots_inbound_date_idx" ON "lots"("inbound_date");

-- CreateIndex
CREATE INDEX "ownership_history_lot_id_effective_date_idx" ON "ownership_history"("lot_id", "effective_date");

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "commodities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_owner_party_id_fkey" FOREIGN KEY ("owner_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_billing_party_id_fkey" FOREIGN KEY ("billing_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "commodities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_variety_id_fkey" FOREIGN KEY ("variety_id") REFERENCES "varieties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_from_party_id_fkey" FOREIGN KEY ("from_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_to_party_id_fkey" FOREIGN KEY ("to_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint: lot balance never negative
ALTER TABLE "lots" ADD CONSTRAINT "lots_current_balance_check" CHECK ("current_balance_bags" >= 0);

-- CHECK constraint: lot quantity must be positive
ALTER TABLE "lots" ADD CONSTRAINT "lots_quantity_bags_check" CHECK ("quantity_bags" > 0);
