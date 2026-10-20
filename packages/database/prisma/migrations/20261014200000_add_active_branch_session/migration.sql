ALTER TABLE "AuthSession" ADD COLUMN "activeBranchId" TEXT;

UPDATE "AuthSession" AS session
SET "activeBranchId" = branch."id"
FROM "Branch" AS branch
WHERE branch."tenantId" = session."activeTenantId"
  AND branch."isPrimary" = TRUE;

ALTER TABLE "AuthSession" ALTER COLUMN "activeBranchId" SET NOT NULL;

CREATE INDEX "AuthSession_activeTenantId_activeBranchId_idx"
ON "AuthSession"("activeTenantId", "activeBranchId");

ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_activeTenantId_activeBranchId_fkey"
FOREIGN KEY ("activeTenantId", "activeBranchId")
REFERENCES "Branch"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
