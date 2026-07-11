-- ============================================================================
-- 0005 — Rooms & Racks
--
-- The client identifies storage as Rooms containing Racks. A "Room" is the
-- existing chambers table (UI-level rename only); racks are new sub-locations
-- within a chamber. A lot's bags may be spread across several racks of its
-- chamber via lot_rack_placements; bags not covered by a placement are
-- implicitly "unplaced". lot_movements is an append-only log of physical
-- moves: initial placement, rack→rack transfer (may be partial), whole-lot
-- room transfer, and placement trims caused by withdrawals.
--
-- Purely additive: no existing table is altered, so the deployed production
-- DB migrates safely and pre-existing lots simply have zero placements.
-- ============================================================================

-- CreateEnum
CREATE TYPE "LotMovementType" AS ENUM ('PLACEMENT', 'RACK_TRANSFER', 'ROOM_TRANSFER', 'WITHDRAWAL_PICK');

-- CreateTable
CREATE TABLE "racks" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "max_capacity_bags" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_rack_placements" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "rack_id" UUID NOT NULL,
    "bags" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lot_rack_placements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lot_rack_placements_bags_positive" CHECK ("bags" > 0)
);

-- CreateTable
CREATE TABLE "lot_movements" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "movement_type" "LotMovementType" NOT NULL,
    "from_chamber_id" UUID,
    "to_chamber_id" UUID,
    "from_rack_id" UUID,
    "to_rack_id" UUID,
    "bags" INTEGER NOT NULL,
    "reason" TEXT,
    "moved_by" UUID NOT NULL,
    "moved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "racks_chamber_id_name_key" ON "racks"("chamber_id", "name");
CREATE INDEX "racks_chamber_id_is_active_idx" ON "racks"("chamber_id", "is_active");

CREATE UNIQUE INDEX "lot_rack_placements_lot_id_rack_id_key" ON "lot_rack_placements"("lot_id", "rack_id");
CREATE INDEX "lot_rack_placements_rack_id_idx" ON "lot_rack_placements"("rack_id");
CREATE INDEX "lot_rack_placements_lot_id_idx" ON "lot_rack_placements"("lot_id");

CREATE INDEX "lot_movements_lot_id_moved_at_idx" ON "lot_movements"("lot_id", "moved_at");

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "racks" ADD CONSTRAINT "racks_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lot_rack_placements" ADD CONSTRAINT "lot_rack_placements_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- lot_id cascades: placements/movements are children of the lot (lots are
-- never deleted by the app; cascade covers test-reset cleanup).
ALTER TABLE "lot_rack_placements" ADD CONSTRAINT "lot_rack_placements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_rack_placements" ADD CONSTRAINT "lot_rack_placements_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_from_chamber_id_fkey" FOREIGN KEY ("from_chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_to_chamber_id_fkey" FOREIGN KEY ("to_chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_from_rack_id_fkey" FOREIGN KEY ("from_rack_id") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_to_rack_id_fkey" FOREIGN KEY ("to_rack_id") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lot_movements" ADD CONSTRAINT "lot_movements_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
