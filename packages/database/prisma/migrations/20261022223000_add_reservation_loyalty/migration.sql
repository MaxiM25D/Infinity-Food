-- CreateEnum
CREATE TYPE "ReservationDepositStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "ReservationDepositType" AS ENUM ('FIXED', 'PER_PERSON');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'BOOKED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'RESERVATION_CONFIRMED';
ALTER TYPE "NotificationEvent" ADD VALUE 'RESERVATION_REMINDER';
ALTER TYPE "NotificationEvent" ADD VALUE 'RESERVATION_WAITLIST_OFFER';

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "reservationId" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "ReservationPolicy" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reminderHours" INTEGER NOT NULL DEFAULT 24,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 2,
    "depositRequired" BOOLEAN NOT NULL DEFAULT false,
    "depositType" "ReservationDepositType" NOT NULL DEFAULT 'FIXED',
    "depositAmountInCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationPolicy_pkey" PRIMARY KEY ("tenantId","branchId")
);

-- CreateTable
CREATE TABLE "ReservationScheduleException" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "opensAtMinutes" INTEGER,
    "closesAtMinutes" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationDeposit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" "ReservationDepositStatus" NOT NULL DEFAULT 'PENDING',
    "amountInCents" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "receivedByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationWaitlistEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reservationId" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "requestedDate" DATE NOT NULL,
    "preferredMinutes" INTEGER,
    "partySize" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "notes" TEXT,
    "clientRequestId" TEXT NOT NULL,
    "offerExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationWaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservationScheduleException_tenantId_branchId_date_idx" ON "ReservationScheduleException"("tenantId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationScheduleException_tenantId_branchId_date_key" ON "ReservationScheduleException"("tenantId", "branchId", "date");

-- CreateIndex
CREATE INDEX "ReservationDeposit_tenantId_branchId_reservationId_idx" ON "ReservationDeposit"("tenantId", "branchId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationDeposit_tenantId_clientRequestId_key" ON "ReservationDeposit"("tenantId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationDeposit_tenantId_id_key" ON "ReservationDeposit"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ReservationWaitlistEntry_tenantId_branchId_requestedDate_st_idx" ON "ReservationWaitlistEntry"("tenantId", "branchId", "requestedDate", "status");

-- CreateIndex
CREATE INDEX "ReservationWaitlistEntry_status_offerExpiresAt_idx" ON "ReservationWaitlistEntry"("status", "offerExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationWaitlistEntry_tenantId_clientRequestId_key" ON "ReservationWaitlistEntry"("tenantId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationWaitlistEntry_tenantId_branchId_id_key" ON "ReservationWaitlistEntry"("tenantId", "branchId", "id");

-- CreateIndex
CREATE INDEX "NotificationLog_tenantId_reservationId_createdAt_idx" ON "NotificationLog"("tenantId", "reservationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_tenantId_reservationId_event_key" ON "NotificationLog"("tenantId", "reservationId", "event");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_customerId_startsAt_idx" ON "Reservation"("tenantId", "customerId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_tenantId_id_key" ON "Reservation"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ReservationPolicy" ADD CONSTRAINT "ReservationPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationPolicy" ADD CONSTRAINT "ReservationPolicy_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationScheduleException" ADD CONSTRAINT "ReservationScheduleException_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationScheduleException" ADD CONSTRAINT "ReservationScheduleException_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_tenantId_branchId_reservationId_fkey" FOREIGN KEY ("tenantId", "branchId", "reservationId") REFERENCES "Reservation"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationWaitlistEntry" ADD CONSTRAINT "ReservationWaitlistEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationWaitlistEntry" ADD CONSTRAINT "ReservationWaitlistEntry_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationWaitlistEntry" ADD CONSTRAINT "ReservationWaitlistEntry_tenantId_branchId_reservationId_fkey" FOREIGN KEY ("tenantId", "branchId", "reservationId") REFERENCES "Reservation"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_tenantId_reservationId_fkey" FOREIGN KEY ("tenantId", "reservationId") REFERENCES "Reservation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
