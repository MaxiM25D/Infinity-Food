CREATE TYPE "DiningOrderSource" AS ENUM ('QR', 'WAITER');
CREATE TYPE "DiningOrderStatus" AS ENUM ('OPEN', 'IN_PREPARATION', 'READY', 'SERVED', 'CLOSED', 'CANCELLED');
CREATE TYPE "OrderRoundStatus" AS ENUM ('SUBMITTED', 'CANCELLED');
CREATE TYPE "KitchenStationType" AS ENUM ('KITCHEN', 'BAR', 'DESSERT', 'OTHER');
CREATE TYPE "KitchenTicketStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

ALTER TABLE "NotificationLog" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "MembershipBranch" RENAME CONSTRAINT "MembershipBranch_branch_fkey" TO "MembershipBranch_tenantId_branchId_fkey";
ALTER TABLE "MembershipBranch" RENAME CONSTRAINT "MembershipBranch_membership_fkey" TO "MembershipBranch_tenantId_userId_fkey";
ALTER TABLE "Order" RENAME CONSTRAINT "Order_branch_fkey" TO "Order_tenantId_branchId_fkey";
ALTER TABLE "RestaurantTable" RENAME CONSTRAINT "RestaurantTable_branch_fkey" TO "RestaurantTable_tenantId_branchId_fkey";
ALTER TABLE "RestaurantTable" RENAME CONSTRAINT "RestaurantTable_sector_fkey" TO "RestaurantTable_tenantId_branchId_sectorId_fkey";
ALTER TABLE "Sector" RENAME CONSTRAINT "Sector_branch_fkey" TO "Sector_tenantId_branchId_fkey";

ALTER TABLE "Order"
  ADD COLUMN "diningClosedAt" TIMESTAMP(3),
  ADD COLUMN "diningOpenedAt" TIMESTAMP(3),
  ADD COLUMN "diningSource" "DiningOrderSource",
  ADD COLUMN "diningStatus" "DiningOrderStatus",
  ADD COLUMN "openedByUserId" TEXT,
  ADD COLUMN "restaurantTableId" TEXT;

ALTER TABLE "OrderItem"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "roundId" TEXT;

ALTER TABLE "MembershipBranch" ADD COLUMN "stationId" TEXT;

CREATE TABLE "KitchenStation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "KitchenStationType" NOT NULL DEFAULT 'KITCHEN',
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KitchenStationMenuItem" (
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitchenStationMenuItem_pkey" PRIMARY KEY ("tenantId", "branchId", "productId")
);

CREATE TABLE "OrderRound" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" "OrderRoundStatus" NOT NULL DEFAULT 'SUBMITTED',
  "clientRequestId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KitchenTicket" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "status" "KitchenTicketStatus" NOT NULL DEFAULT 'PENDING',
  "claimedByUserId" TEXT,
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "servedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KitchenTicketItem" (
  "tenantId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitchenTicketItem_pkey" PRIMARY KEY ("tenantId", "ticketId", "orderItemId")
);

CREATE TABLE "DiningOrderAudit" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningOrderAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KitchenStation_tenantId_branchId_name_key" ON "KitchenStation"("tenantId", "branchId", "name");
CREATE UNIQUE INDEX "KitchenStation_tenantId_branchId_id_key" ON "KitchenStation"("tenantId", "branchId", "id");
CREATE INDEX "KitchenStation_tenantId_branchId_active_displayOrder_idx" ON "KitchenStation"("tenantId", "branchId", "active", "displayOrder");
CREATE INDEX "KitchenStationMenuItem_tenantId_branchId_stationId_idx" ON "KitchenStationMenuItem"("tenantId", "branchId", "stationId");
CREATE INDEX "MembershipBranch_tenantId_branchId_stationId_idx" ON "MembershipBranch"("tenantId", "branchId", "stationId");
CREATE UNIQUE INDEX "OrderRound_tenantId_clientRequestId_key" ON "OrderRound"("tenantId", "clientRequestId");
CREATE UNIQUE INDEX "OrderRound_tenantId_orderId_number_key" ON "OrderRound"("tenantId", "orderId", "number");
CREATE UNIQUE INDEX "OrderRound_tenantId_orderId_id_key" ON "OrderRound"("tenantId", "orderId", "id");
CREATE UNIQUE INDEX "OrderRound_tenantId_branchId_id_key" ON "OrderRound"("tenantId", "branchId", "id");
CREATE INDEX "OrderRound_tenantId_branchId_createdAt_idx" ON "OrderRound"("tenantId", "branchId", "createdAt");
CREATE INDEX "OrderRound_submittedByUserId_idx" ON "OrderRound"("submittedByUserId");
CREATE UNIQUE INDEX "KitchenTicket_tenantId_roundId_stationId_key" ON "KitchenTicket"("tenantId", "roundId", "stationId");
CREATE UNIQUE INDEX "KitchenTicket_tenantId_id_key" ON "KitchenTicket"("tenantId", "id");
CREATE INDEX "KitchenTicket_tenantId_branchId_stationId_status_createdAt_idx" ON "KitchenTicket"("tenantId", "branchId", "stationId", "status", "createdAt");
CREATE INDEX "KitchenTicket_claimedByUserId_idx" ON "KitchenTicket"("claimedByUserId");
CREATE UNIQUE INDEX "KitchenTicketItem_tenantId_orderItemId_key" ON "KitchenTicketItem"("tenantId", "orderItemId");
CREATE INDEX "DiningOrderAudit_tenantId_branchId_createdAt_idx" ON "DiningOrderAudit"("tenantId", "branchId", "createdAt");
CREATE INDEX "DiningOrderAudit_tenantId_orderId_createdAt_idx" ON "DiningOrderAudit"("tenantId", "orderId", "createdAt");
CREATE INDEX "DiningOrderAudit_actorUserId_idx" ON "DiningOrderAudit"("actorUserId");
CREATE UNIQUE INDEX "DiningOrderAudit_eventId_key" ON "DiningOrderAudit"("eventId");
CREATE INDEX "Order_tenantId_branchId_diningStatus_createdAt_idx" ON "Order"("tenantId", "branchId", "diningStatus", "createdAt");
CREATE INDEX "Order_tenantId_branchId_restaurantTableId_diningStatus_idx" ON "Order"("tenantId", "branchId", "restaurantTableId", "diningStatus");
CREATE UNIQUE INDEX "OrderItem_tenantId_id_key" ON "OrderItem"("tenantId", "id");
CREATE INDEX "OrderItem_tenantId_orderId_roundId_idx" ON "OrderItem"("tenantId", "orderId", "roundId");

ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenStation" ADD CONSTRAINT "KitchenStation_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenStationMenuItem" ADD CONSTRAINT "KitchenStationMenuItem_tenantId_branchId_stationId_fkey" FOREIGN KEY ("tenantId", "branchId", "stationId") REFERENCES "KitchenStation"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenStationMenuItem" ADD CONSTRAINT "KitchenStationMenuItem_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_branchId_stationId_fkey" FOREIGN KEY ("tenantId", "branchId", "stationId") REFERENCES "KitchenStation"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_branchId_restaurantTableId_fkey" FOREIGN KEY ("tenantId", "branchId", "restaurantTableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_orderId_roundId_fkey" FOREIGN KEY ("tenantId", "orderId", "roundId") REFERENCES "OrderRound"("tenantId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_tenantId_branchId_roundId_fkey" FOREIGN KEY ("tenantId", "branchId", "roundId") REFERENCES "OrderRound"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_tenantId_branchId_stationId_fkey" FOREIGN KEY ("tenantId", "branchId", "stationId") REFERENCES "KitchenStation"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_tenantId_ticketId_fkey" FOREIGN KEY ("tenantId", "ticketId") REFERENCES "KitchenTicket"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KitchenTicketItem" ADD CONSTRAINT "KitchenTicketItem_tenantId_orderItemId_fkey" FOREIGN KEY ("tenantId", "orderItemId") REFERENCES "OrderItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningOrderAudit" ADD CONSTRAINT "DiningOrderAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningOrderAudit" ADD CONSTRAINT "DiningOrderAudit_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningOrderAudit" ADD CONSTRAINT "DiningOrderAudit_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningOrderAudit" ADD CONSTRAINT "DiningOrderAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "KitchenStation" ("id", "tenantId", "branchId", "name", "type", "displayOrder", "active", "updatedAt")
SELECT 'kitchen_' || md5("id"), "tenantId", "id", 'Cocina', 'KITCHEN', 0, true, CURRENT_TIMESTAMP
FROM "Branch";

INSERT INTO "KitchenStationMenuItem" ("tenantId", "branchId", "stationId", "productId")
SELECT bmi."tenantId", bmi."branchId", ks."id", bmi."productId"
FROM "BranchMenuItem" bmi
JOIN "KitchenStation" ks ON ks."tenantId" = bmi."tenantId" AND ks."branchId" = bmi."branchId" AND ks."name" = 'Cocina';
