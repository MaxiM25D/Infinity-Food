-- CreateEnum
CREATE TYPE "ReportDimension" AS ENUM ('BRANCH', 'CHANNEL', 'PAYMENT_METHOD', 'HOUR_BAND');

-- CreateTable
CREATE TABLE "ReportPaymentFact" (
    "paymentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportPaymentFact_pkey" PRIMARY KEY ("paymentId")
);

-- CreateTable
CREATE TABLE "ReportSalesAggregate" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "dimension" "ReportDimension" NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "dimensionLabel" TEXT NOT NULL,
    "grossInCents" INTEGER NOT NULL DEFAULT 0,
    "refundsInCents" INTEGER NOT NULL DEFAULT 0,
    "payments" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportSalesAggregate_pkey" PRIMARY KEY ("tenantId", "branchId", "localDate", "dimension", "dimensionKey")
);

CREATE INDEX "ReportPaymentFact_tenantId_branchId_localDate_idx" ON "ReportPaymentFact"("tenantId", "branchId", "localDate");
CREATE INDEX "ReportSalesAggregate_tenantId_localDate_dimension_idx" ON "ReportSalesAggregate"("tenantId", "localDate", "dimension");

ALTER TABLE "ReportPaymentFact" ADD CONSTRAINT "ReportPaymentFact_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OrderPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportPaymentFact" ADD CONSTRAINT "ReportPaymentFact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportPaymentFact" ADD CONSTRAINT "ReportPaymentFact_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSalesAggregate" ADD CONSTRAINT "ReportSalesAggregate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSalesAggregate" ADD CONSTRAINT "ReportSalesAggregate_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
