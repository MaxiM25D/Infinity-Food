-- InfinityFood introduces branches as the operational boundary below each tenant.
CREATE TYPE "BranchRole" AS ENUM ('MANAGER', 'WAITER', 'KITCHEN', 'CASHIER', 'STAFF');
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'BLOCKED', 'INACTIVE');

CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MembershipBranch" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BranchRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipBranch_pkey" PRIMARY KEY ("tenantId", "branchId", "userId")
);

CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RestaurantTable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sectorId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minCapacity" INTEGER NOT NULL DEFAULT 1,
    "maxCapacity" INTEGER NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Branch_tenantId_slug_key" ON "Branch"("tenantId", "slug");
CREATE UNIQUE INDEX "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");
CREATE UNIQUE INDEX "Branch_one_primary_per_tenant_key" ON "Branch"("tenantId") WHERE "isPrimary" = true;
CREATE INDEX "Branch_tenantId_status_idx" ON "Branch"("tenantId", "status");
CREATE INDEX "MembershipBranch_tenantId_userId_idx" ON "MembershipBranch"("tenantId", "userId");
CREATE INDEX "MembershipBranch_userId_idx" ON "MembershipBranch"("userId");
CREATE UNIQUE INDEX "Sector_tenantId_branchId_name_key" ON "Sector"("tenantId", "branchId", "name");
CREATE UNIQUE INDEX "Sector_tenantId_branchId_id_key" ON "Sector"("tenantId", "branchId", "id");
CREATE INDEX "Sector_tenantId_branchId_active_idx" ON "Sector"("tenantId", "branchId", "active");
CREATE UNIQUE INDEX "RestaurantTable_tenantId_branchId_code_key" ON "RestaurantTable"("tenantId", "branchId", "code");
CREATE UNIQUE INDEX "RestaurantTable_tenantId_branchId_id_key" ON "RestaurantTable"("tenantId", "branchId", "id");
CREATE INDEX "RestaurantTable_tenantId_branchId_status_idx" ON "RestaurantTable"("tenantId", "branchId", "status");
CREATE INDEX "RestaurantTable_tenantId_branchId_sectorId_idx" ON "RestaurantTable"("tenantId", "branchId", "sectorId");

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_membership_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "Membership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_sector_fkey" FOREIGN KEY ("tenantId", "branchId", "sectorId") REFERENCES "Sector"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Branch" ("id", "tenantId", "slug", "name", "status", "isPrimary", "timezone", "createdAt", "updatedAt")
SELECT CONCAT("id", '-main'), "id", 'principal', 'Casa central', 'ACTIVE', true, 'America/Argentina/Buenos_Aires', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant";

INSERT INTO "MembershipBranch" ("tenantId", "branchId", "userId", "role", "createdAt", "updatedAt")
SELECT membership."tenantId", CONCAT(membership."tenantId", '-main'), membership."userId", 'STAFF', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Membership" membership
WHERE membership."role" = 'STAFF';

ALTER TABLE "Order" ADD COLUMN "branchId" TEXT;
UPDATE "Order" SET "branchId" = CONCAT("tenantId", '-main');
ALTER TABLE "Order" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Order_tenantId_branchId_status_idx" ON "Order"("tenantId", "branchId", "status");
ALTER TABLE "Order" ADD CONSTRAINT "Order_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
