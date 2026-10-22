CREATE TYPE "OrderAdjustmentType" AS ENUM ('DISCOUNT', 'TIP', 'COMPLIMENT');
CREATE TYPE "PrintJobType" AS ENUM ('KITCHEN', 'RECEIPT');
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED', 'CANCELLED');

ALTER TABLE "OrderItem" ADD COLUMN "preparationPoint" TEXT;

CREATE TABLE "MenuModifierGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minChoices" INTEGER NOT NULL DEFAULT 0,
  "maxChoices" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuModifierGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuModifierOption" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceInCents" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuModifierOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItemModifier" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "modifierOptionId" TEXT,
  "groupName" TEXT NOT NULL,
  "optionName" TEXT NOT NULL,
  "unitPriceInCents" INTEGER NOT NULL,
  "totalPriceInCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderAdjustment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "type" "OrderAdjustmentType" NOT NULL,
  "label" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "amountInCents" INTEGER NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderPaymentAllocation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderPaymentId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "guestLabel" TEXT,
  "amountInCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderPaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiningTableGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "primaryTableId" TEXT NOT NULL,
  "label" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningTableGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiningTableGroupMember" (
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "activeKey" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "DiningTableGroupMember_pkey" PRIMARY KEY ("tenantId", "branchId", "groupId", "tableId")
);

CREATE TABLE "PrintJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kitchenTicketId" TEXT,
  "type" "PrintJobType" NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "clientRequestId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "claimedByUserId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuModifierGroup_tenantId_branchId_productId_name_key" ON "MenuModifierGroup"("tenantId", "branchId", "productId", "name");
CREATE UNIQUE INDEX "MenuModifierGroup_tenantId_branchId_id_key" ON "MenuModifierGroup"("tenantId", "branchId", "id");
CREATE INDEX "MenuModifierGroup_tenantId_branchId_productId_active_sortOrder_idx" ON "MenuModifierGroup"("tenantId", "branchId", "productId", "active", "sortOrder");
CREATE UNIQUE INDEX "MenuModifierOption_tenantId_branchId_groupId_name_key" ON "MenuModifierOption"("tenantId", "branchId", "groupId", "name");
CREATE UNIQUE INDEX "MenuModifierOption_tenantId_id_key" ON "MenuModifierOption"("tenantId", "id");
CREATE INDEX "MenuModifierOption_tenantId_branchId_groupId_active_sortOrder_idx" ON "MenuModifierOption"("tenantId", "branchId", "groupId", "active", "sortOrder");
CREATE UNIQUE INDEX "OrderItemModifier_tenantId_orderItemId_modifierOptionId_key" ON "OrderItemModifier"("tenantId", "orderItemId", "modifierOptionId");
CREATE INDEX "OrderItemModifier_tenantId_orderItemId_idx" ON "OrderItemModifier"("tenantId", "orderItemId");
CREATE UNIQUE INDEX "OrderAdjustment_tenantId_clientRequestId_key" ON "OrderAdjustment"("tenantId", "clientRequestId");
CREATE UNIQUE INDEX "OrderAdjustment_tenantId_id_key" ON "OrderAdjustment"("tenantId", "id");
CREATE INDEX "OrderAdjustment_tenantId_branchId_orderId_createdAt_idx" ON "OrderAdjustment"("tenantId", "branchId", "orderId", "createdAt");
CREATE INDEX "OrderAdjustment_createdByUserId_idx" ON "OrderAdjustment"("createdByUserId");
CREATE UNIQUE INDEX "OrderPaymentAllocation_tenantId_orderPaymentId_orderItemId_guestLabel_key" ON "OrderPaymentAllocation"("tenantId", "orderPaymentId", "orderItemId", "guestLabel");
CREATE INDEX "OrderPaymentAllocation_tenantId_branchId_orderId_createdAt_idx" ON "OrderPaymentAllocation"("tenantId", "branchId", "orderId", "createdAt");
CREATE INDEX "OrderPaymentAllocation_tenantId_orderItemId_idx" ON "OrderPaymentAllocation"("tenantId", "orderItemId");
CREATE UNIQUE INDEX "DiningTableGroup_tenantId_branchId_id_key" ON "DiningTableGroup"("tenantId", "branchId", "id");
CREATE INDEX "DiningTableGroup_tenantId_branchId_closedAt_createdAt_idx" ON "DiningTableGroup"("tenantId", "branchId", "closedAt", "createdAt");
CREATE INDEX "DiningTableGroup_createdByUserId_idx" ON "DiningTableGroup"("createdByUserId");
CREATE UNIQUE INDEX "DiningTableGroupMember_activeKey_key" ON "DiningTableGroupMember"("activeKey");
CREATE INDEX "DiningTableGroupMember_tenantId_branchId_tableId_leftAt_idx" ON "DiningTableGroupMember"("tenantId", "branchId", "tableId", "leftAt");
CREATE UNIQUE INDEX "PrintJob_tenantId_clientRequestId_key" ON "PrintJob"("tenantId", "clientRequestId");
CREATE UNIQUE INDEX "PrintJob_tenantId_id_key" ON "PrintJob"("tenantId", "id");
CREATE INDEX "PrintJob_tenantId_branchId_status_createdAt_idx" ON "PrintJob"("tenantId", "branchId", "status", "createdAt");
CREATE INDEX "PrintJob_tenantId_kitchenTicketId_idx" ON "PrintJob"("tenantId", "kitchenTicketId");

ALTER TABLE "MenuModifierGroup" ADD CONSTRAINT "MenuModifierGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuModifierGroup" ADD CONSTRAINT "MenuModifierGroup_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuModifierGroup" ADD CONSTRAINT "MenuModifierGroup_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuModifierOption" ADD CONSTRAINT "MenuModifierOption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuModifierOption" ADD CONSTRAINT "MenuModifierOption_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuModifierOption" ADD CONSTRAINT "MenuModifierOption_group_fkey" FOREIGN KEY ("tenantId", "branchId", "groupId") REFERENCES "MenuModifierGroup"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItem_fkey" FOREIGN KEY ("tenantId", "orderItemId") REFERENCES "OrderItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_option_fkey" FOREIGN KEY ("tenantId", "modifierOptionId") REFERENCES "MenuModifierOption"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_order_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_orderItem_fkey" FOREIGN KEY ("tenantId", "orderItemId") REFERENCES "OrderItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentAllocation" ADD CONSTRAINT "OrderPaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentAllocation" ADD CONSTRAINT "OrderPaymentAllocation_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentAllocation" ADD CONSTRAINT "OrderPaymentAllocation_order_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentAllocation" ADD CONSTRAINT "OrderPaymentAllocation_payment_fkey" FOREIGN KEY ("tenantId", "branchId", "orderPaymentId") REFERENCES "OrderPayment"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPaymentAllocation" ADD CONSTRAINT "OrderPaymentAllocation_orderItem_fkey" FOREIGN KEY ("tenantId", "orderItemId") REFERENCES "OrderItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroup" ADD CONSTRAINT "DiningTableGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroup" ADD CONSTRAINT "DiningTableGroup_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroup" ADD CONSTRAINT "DiningTableGroup_primaryTable_fkey" FOREIGN KEY ("tenantId", "branchId", "primaryTableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroup" ADD CONSTRAINT "DiningTableGroup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroupMember" ADD CONSTRAINT "DiningTableGroupMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroupMember" ADD CONSTRAINT "DiningTableGroupMember_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroupMember" ADD CONSTRAINT "DiningTableGroupMember_group_fkey" FOREIGN KEY ("tenantId", "branchId", "groupId") REFERENCES "DiningTableGroup"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiningTableGroupMember" ADD CONSTRAINT "DiningTableGroupMember_table_fkey" FOREIGN KEY ("tenantId", "branchId", "tableId") REFERENCES "RestaurantTable"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_branch_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_order_fkey" FOREIGN KEY ("tenantId", "branchId", "orderId") REFERENCES "Order"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_ticket_fkey" FOREIGN KEY ("tenantId", "kitchenTicketId") REFERENCES "KitchenTicket"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
