-- CreateEnum
CREATE TYPE "PaymentFlow" AS ENUM ('STOREFRONT', 'POS');

-- CreateEnum
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('PENDING', 'RECONCILED', 'MISMATCH', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FiscalProvider" AS ENUM ('DISABLED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'ISSUED', 'REJECTED');

-- AlterTable
ALTER TABLE "OrderPayment" ADD COLUMN     "paymentAttemptId" TEXT,
ADD COLUMN     "providerFeeInCents" INTEGER,
ADD COLUMN     "providerNetInCents" INTEGER,
ADD COLUMN     "providerPaymentId" TEXT,
ADD COLUMN     "providerReleasedAt" TIMESTAMP(3),
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "reconciliationStatus" "PaymentReconciliationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "cashSessionId" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "flow" "PaymentFlow" NOT NULL DEFAULT 'STOREFRONT';

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "provider" "FiscalProvider" NOT NULL DEFAULT 'DISABLED',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "taxId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxCondition" TEXT NOT NULL,
    "pointOfSale" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("tenantId","branchId")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "FiscalDocumentType" NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "clientRequestId" TEXT NOT NULL,
    "relatedDocumentId" TEXT,
    "providerDocumentId" TEXT,
    "pointOfSale" INTEGER NOT NULL,
    "documentNumber" INTEGER,
    "totalInCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "recipientTaxId" TEXT,
    "recipientName" TEXT,
    "authorizationCode" TEXT,
    "authorizationExpiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "providerResponse" JSONB,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_branchId_issuedAt_idx" ON "FiscalDocument"("tenantId", "branchId", "issuedAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_branchId_orderId_idx" ON "FiscalDocument"("tenantId", "branchId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_clientRequestId_key" ON "FiscalDocument"("tenantId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_id_key" ON "FiscalDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_providerDocumentId_key" ON "FiscalDocument"("tenantId", "providerDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_branchId_pointOfSale_documentNumber_key" ON "FiscalDocument"("tenantId", "branchId", "pointOfSale", "documentNumber", "type");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_paymentAttemptId_key" ON "OrderPayment"("paymentAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPayment_providerPaymentId_key" ON "OrderPayment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_tenantId_branchId_cashSessionId_idx" ON "PaymentAttempt"("tenantId", "branchId", "cashSessionId");

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_tenantId_branchId_cashSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "cashSessionId") REFERENCES "CashRegisterSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_relatedDocumentId_fkey" FOREIGN KEY ("tenantId", "relatedDocumentId") REFERENCES "FiscalDocument"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
