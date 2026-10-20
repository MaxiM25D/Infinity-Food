CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "ReservationStatus" AS ENUM ('HOLD', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'SEATED', 'COMPLETED', 'EXPIRED');

CREATE TABLE "ReservationSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAtMinutes" INTEGER NOT NULL,
    "closesAtMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservationSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReservationSchedule_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "ReservationSchedule_hours_check" CHECK ("opensAtMinutes" BETWEEN 0 AND 1439 AND "closesAtMinutes" BETWEEN 1 AND 1440 AND "closesAtMinutes" > "opensAtMinutes")
);

CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HOLD',
    "partySize" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "notes" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "clientRequestId" TEXT NOT NULL,
    "manageTokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Reservation_party_size_check" CHECK ("partySize" > 0),
    CONSTRAINT "Reservation_range_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "Reservation_hold_expiry_check" CHECK ("status" <> 'HOLD' OR "holdExpiresAt" IS NOT NULL)
);

CREATE TABLE "ReservationAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "fromStatus" "ReservationStatus",
    "toStatus" "ReservationStatus" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReservationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationSchedule_tenantId_branchId_weekday_key" ON "ReservationSchedule"("tenantId", "branchId", "weekday");
CREATE INDEX "ReservationSchedule_tenantId_branchId_active_idx" ON "ReservationSchedule"("tenantId", "branchId", "active");
CREATE UNIQUE INDEX "Reservation_manageTokenHash_key" ON "Reservation"("manageTokenHash");
CREATE UNIQUE INDEX "Reservation_tenantId_clientRequestId_key" ON "Reservation"("tenantId", "clientRequestId");
CREATE UNIQUE INDEX "Reservation_tenantId_branchId_id_key" ON "Reservation"("tenantId", "branchId", "id");
CREATE INDEX "Reservation_tenantId_branchId_startsAt_status_idx" ON "Reservation"("tenantId", "branchId", "startsAt", "status");
CREATE INDEX "Reservation_status_holdExpiresAt_idx" ON "Reservation"("status", "holdExpiresAt");
CREATE INDEX "Reservation_tableId_startsAt_endsAt_idx" ON "Reservation"("tableId", "startsAt", "endsAt");
CREATE INDEX "ReservationAudit_tenantId_branchId_reservationId_createdAt_idx" ON "ReservationAudit"("tenantId", "branchId", "reservationId", "createdAt");
CREATE INDEX "ReservationAudit_actorUserId_idx" ON "ReservationAudit"("actorUserId");

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_no_overlapping_active_ranges"
EXCLUDE USING gist (
    "tableId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
) WHERE ("status" IN ('HOLD', 'CONFIRMED', 'SEATED'));

ALTER TABLE "ReservationSchedule" ADD CONSTRAINT "ReservationSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationSchedule" ADD CONSTRAINT "ReservationSchedule_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_branchId_tableId_fkey" FOREIGN KEY ("tenantId", "branchId", "tableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReservationAudit" ADD CONSTRAINT "ReservationAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationAudit" ADD CONSTRAINT "ReservationAudit_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationAudit" ADD CONSTRAINT "ReservationAudit_tenantId_branchId_reservationId_fkey" FOREIGN KEY ("tenantId", "branchId", "reservationId") REFERENCES "Reservation"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationAudit" ADD CONSTRAINT "ReservationAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
