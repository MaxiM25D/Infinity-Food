CREATE TYPE "MenuItemAvailability" AS ENUM ('AVAILABLE', 'SOLD_OUT', 'HIDDEN');

ALTER TABLE "Category"
ADD COLUMN "description" TEXT,
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "Product"
ADD COLUMN "preparationTimeMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "allergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "dietaryTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "BranchMenuItem" (
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "availability" "MenuItemAvailability" NOT NULL DEFAULT 'AVAILABLE',
  "priceOverrideInCents" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "featured" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchMenuItem_pkey" PRIMARY KEY ("tenantId", "branchId", "productId")
);

INSERT INTO "BranchMenuItem" (
  "tenantId", "branchId", "productId", "availability", "featured", "sortOrder", "updatedAt"
)
SELECT product."tenantId", branch."id", product."id", 'AVAILABLE'::"MenuItemAvailability",
       product."featured", product."featuredOrder", CURRENT_TIMESTAMP
FROM "Product" AS product
JOIN "Branch" AS branch ON branch."tenantId" = product."tenantId";

CREATE INDEX "BranchMenuItem_tenantId_branchId_availability_sortOrder_idx"
ON "BranchMenuItem"("tenantId", "branchId", "availability", "sortOrder");

CREATE INDEX "BranchMenuItem_tenantId_productId_idx"
ON "BranchMenuItem"("tenantId", "productId");

ALTER TABLE "BranchMenuItem"
ADD CONSTRAINT "BranchMenuItem_tenantId_branchId_fkey"
FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BranchMenuItem"
ADD CONSTRAINT "BranchMenuItem_tenantId_productId_fkey"
FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BranchMenuItem"
ADD CONSTRAINT "BranchMenuItem_priceOverrideInCents_check"
CHECK ("priceOverrideInCents" IS NULL OR "priceOverrideInCents" >= 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_preparationTimeMinutes_check"
CHECK ("preparationTimeMinutes" BETWEEN 0 AND 1440);
