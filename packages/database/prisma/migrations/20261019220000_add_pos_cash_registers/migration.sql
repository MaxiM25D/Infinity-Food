CREATE TYPE "OrderPaymentKind" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'CASH_SALE', 'CASH_REFUND', 'INCOME', 'EXPENSE', 'ADJUSTMENT');

ALTER TYPE "DiningOrderSource" ADD VALUE 'POS';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_PAID';

CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "kind" "OrderPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "method" "PaymentMethod" NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "reference" TEXT,
    "refundOfId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderPayment_positive_amount" CHECK ("amountInCents" > 0),
    CONSTRAINT "OrderPayment_refund_target" CHECK (("kind" = 'PAYMENT' AND "refundOfId" IS NULL) OR ("kind" = 'REFUND' AND "refundOfId" IS NOT NULL))
);

CREATE TABLE "CashRegister" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashRegisterSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "openKey" TEXT,
    "openingCashInCents" INTEGER NOT NULL,
    "expectedClosingCashInCents" INTEGER,
    "declaredClosingCashInCents" INTEGER,
    "differenceInCents" INTEGER,
    "salesTotalInCents" INTEGER,
    "cashSalesInCents" INTEGER,
    "cardSalesInCents" INTEGER,
    "mercadoPagoSalesInCents" INTEGER,
    "manualMovementsInCents" INTEGER,
    "openingNote" TEXT,
    "closingNote" TEXT,
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CashRegisterSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashRegisterSession_non_negative_opening" CHECK ("openingCashInCents" >= 0)
);

CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "orderPaymentId" TEXT,
    "type" "CashMovementType" NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashMovement_non_zero_amount" CHECK ("amountInCents" <> 0)
);

CREATE INDEX "OrderPayment_tenantId_branchId_orderId_createdAt_idx" ON "OrderPayment"("tenantId", "branchId", "orderId", "createdAt");
CREATE INDEX "OrderPayment_tenantId_branchId_cashSessionId_createdAt_idx" ON "OrderPayment"("tenantId", "branchId", "cashSessionId", "createdAt");
CREATE INDEX "OrderPayment_tenantId_branchId_refundOfId_idx" ON "OrderPayment"("tenantId", "branchId", "refundOfId");
CREATE INDEX "OrderPayment_createdByUserId_idx" ON "OrderPayment"("createdByUserId");
CREATE UNIQUE INDEX "OrderPayment_tenantId_clientRequestId_key" ON "OrderPayment"("tenantId", "clientRequestId");
CREATE UNIQUE INDEX "OrderPayment_tenantId_id_key" ON "OrderPayment"("tenantId", "id");
CREATE UNIQUE INDEX "OrderPayment_tenantId_branchId_id_key" ON "OrderPayment"("tenantId", "branchId", "id");

CREATE INDEX "CashRegister_tenantId_branchId_active_idx" ON "CashRegister"("tenantId", "branchId", "active");
CREATE UNIQUE INDEX "CashRegister_tenantId_branchId_name_key" ON "CashRegister"("tenantId", "branchId", "name");
CREATE UNIQUE INDEX "CashRegister_tenantId_branchId_id_key" ON "CashRegister"("tenantId", "branchId", "id");

CREATE UNIQUE INDEX "CashRegisterSession_openKey_key" ON "CashRegisterSession"("openKey");
CREATE INDEX "CashRegisterSession_tenantId_branchId_openedAt_idx" ON "CashRegisterSession"("tenantId", "branchId", "openedAt");
CREATE INDEX "CashRegisterSession_tenantId_branchId_cashRegisterId_closed_idx" ON "CashRegisterSession"("tenantId", "branchId", "cashRegisterId", "closedAt");
CREATE INDEX "CashRegisterSession_openedByUserId_idx" ON "CashRegisterSession"("openedByUserId");
CREATE INDEX "CashRegisterSession_closedByUserId_idx" ON "CashRegisterSession"("closedByUserId");
CREATE UNIQUE INDEX "CashRegisterSession_tenantId_branchId_id_key" ON "CashRegisterSession"("tenantId", "branchId", "id");

CREATE INDEX "CashMovement_tenantId_branchId_cashSessionId_createdAt_idx" ON "CashMovement"("tenantId", "branchId", "cashSessionId", "createdAt");
CREATE INDEX "CashMovement_createdByUserId_idx" ON "CashMovement"("createdByUserId");
CREATE UNIQUE INDEX "CashMovement_tenantId_id_key" ON "CashMovement"("tenantId", "id");
CREATE UNIQUE INDEX "CashMovement_tenantId_branchId_orderPaymentId_key" ON "CashMovement"("tenantId", "branchId", "orderPaymentId");

CREATE UNIQUE INDEX "Order_tenantId_branchId_id_key" ON "Order"("tenantId", "branchId", "id");

ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_branchId_orderId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_branchId_cashSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "cashSessionId") REFERENCES "CashRegisterSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_tenantId_branchId_refundOfId_fkey" FOREIGN KEY ("tenantId", "branchId", "refundOfId") REFERENCES "OrderPayment"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_tenantId_branchId_cashRegisterId_fkey" FOREIGN KEY ("tenantId", "branchId", "cashRegisterId") REFERENCES "CashRegister"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashRegisterSession" ADD CONSTRAINT "CashRegisterSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_branchId_cashSessionId_fkey" FOREIGN KEY ("tenantId", "branchId", "cashSessionId") REFERENCES "CashRegisterSession"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_tenantId_branchId_orderPaymentId_fkey" FOREIGN KEY ("tenantId", "branchId", "orderPaymentId") REFERENCES "OrderPayment"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
