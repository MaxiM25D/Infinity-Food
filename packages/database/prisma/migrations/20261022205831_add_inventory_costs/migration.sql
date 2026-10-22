-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('GRAM', 'MILLILITER', 'UNIT');

-- CreateEnum
CREATE TYPE "IngredientMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE_CONSUMPTION', 'SALE_REVERSAL', 'WASTE', 'MANUAL_ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- Every existing branch starts with one operational warehouse.
INSERT INTO "InventoryLocation" ("id", "tenantId", "branchId", "code", "name", "isDefault", "active", "createdAt", "updatedAt")
SELECT 'loc_' || md5("tenantId" || ':' || "id"), "tenantId", "id", 'MAIN', 'Depósito principal', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Branch";

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientStock" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "averageCostPerThousandCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientStock_pkey" PRIMARY KEY ("tenantId","branchId","locationId","ingredientId")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("tenantId","productId","ingredientId")
);

-- CreateTable
CREATE TABLE "IngredientMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "purchaseReceiptId" TEXT,
    "changedByUserId" TEXT,
    "type" "IngredientMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "costTotalInCents" INTEGER,
    "clientRequestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostPerThousandInCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costInCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLocation_tenantId_branchId_active_idx" ON "InventoryLocation"("tenantId", "branchId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_tenantId_branchId_code_key" ON "InventoryLocation"("tenantId", "branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_tenantId_branchId_id_key" ON "InventoryLocation"("tenantId", "branchId", "id");

CREATE UNIQUE INDEX "InventoryLocation_one_default_per_branch_key" ON "InventoryLocation"("tenantId", "branchId") WHERE "isDefault" = true;

-- CreateIndex
CREATE INDEX "Ingredient_tenantId_active_name_idx" ON "Ingredient"("tenantId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_tenantId_code_key" ON "Ingredient"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_tenantId_id_key" ON "Ingredient"("tenantId", "id");

-- CreateIndex
CREATE INDEX "IngredientStock_tenantId_branchId_ingredientId_idx" ON "IngredientStock"("tenantId", "branchId", "ingredientId");

-- CreateIndex
CREATE INDEX "IngredientStock_tenantId_branchId_quantity_idx" ON "IngredientStock"("tenantId", "branchId", "quantity");

-- CreateIndex
CREATE INDEX "RecipeIngredient_tenantId_ingredientId_idx" ON "RecipeIngredient"("tenantId", "ingredientId");

-- CreateIndex
CREATE INDEX "IngredientMovement_tenantId_branchId_locationId_ingredientI_idx" ON "IngredientMovement"("tenantId", "branchId", "locationId", "ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "IngredientMovement_tenantId_orderId_idx" ON "IngredientMovement"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "IngredientMovement_tenantId_orderItemId_idx" ON "IngredientMovement"("tenantId", "orderItemId");

-- CreateIndex
CREATE INDEX "IngredientMovement_tenantId_purchaseReceiptId_idx" ON "IngredientMovement"("tenantId", "purchaseReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientMovement_tenantId_clientRequestId_key" ON "IngredientMovement"("tenantId", "clientRequestId");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_active_idx" ON "Supplier"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_name_key" ON "Supplier"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_id_key" ON "Supplier"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_branchId_status_createdAt_idx" ON "PurchaseOrder"("tenantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_supplierId_idx" ON "PurchaseOrder"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_branchId_number_key" ON "PurchaseOrder"("tenantId", "branchId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_id_key" ON "PurchaseOrder"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_tenantId_ingredientId_idx" ON "PurchaseOrderItem"("tenantId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_tenantId_purchaseOrderId_ingredientId_key" ON "PurchaseOrderItem"("tenantId", "purchaseOrderId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_tenantId_id_key" ON "PurchaseOrderItem"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_tenantId_branchId_createdAt_idx" ON "PurchaseReceipt"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_tenantId_purchaseOrderId_idx" ON "PurchaseReceipt"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_tenantId_clientRequestId_key" ON "PurchaseReceipt"("tenantId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_tenantId_id_key" ON "PurchaseReceipt"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseReceiptItem_tenantId_ingredientId_idx" ON "PurchaseReceiptItem"("tenantId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptItem_tenantId_receiptId_purchaseOrderItemId_key" ON "PurchaseReceiptItem"("tenantId", "receiptId", "purchaseOrderItemId");

-- RenameForeignKey
ALTER TABLE "DiningTableGroup" RENAME CONSTRAINT "DiningTableGroup_branch_fkey" TO "DiningTableGroup_tenantId_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "DiningTableGroup" RENAME CONSTRAINT "DiningTableGroup_primaryTable_fkey" TO "DiningTableGroup_tenantId_branchId_primaryTableId_fkey";

-- RenameForeignKey
ALTER TABLE "DiningTableGroupMember" RENAME CONSTRAINT "DiningTableGroupMember_branch_fkey" TO "DiningTableGroupMember_tenantId_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "DiningTableGroupMember" RENAME CONSTRAINT "DiningTableGroupMember_group_fkey" TO "DiningTableGroupMember_tenantId_branchId_groupId_fkey";

-- RenameForeignKey
ALTER TABLE "DiningTableGroupMember" RENAME CONSTRAINT "DiningTableGroupMember_table_fkey" TO "DiningTableGroupMember_tenantId_branchId_tableId_fkey";

-- RenameForeignKey
ALTER TABLE "MenuModifierOption" RENAME CONSTRAINT "MenuModifierOption_group_fkey" TO "MenuModifierOption_tenantId_branchId_groupId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderAdjustment" RENAME CONSTRAINT "OrderAdjustment_branch_fkey" TO "OrderAdjustment_tenantId_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderAdjustment" RENAME CONSTRAINT "OrderAdjustment_orderItem_fkey" TO "OrderAdjustment_tenantId_orderItemId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderAdjustment" RENAME CONSTRAINT "OrderAdjustment_order_fkey" TO "OrderAdjustment_tenantId_branchId_orderId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderItemModifier" RENAME CONSTRAINT "OrderItemModifier_option_fkey" TO "OrderItemModifier_modifierOptionId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderItemModifier" RENAME CONSTRAINT "OrderItemModifier_orderItem_fkey" TO "OrderItemModifier_tenantId_orderItemId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderPaymentAllocation" RENAME CONSTRAINT "OrderPaymentAllocation_branch_fkey" TO "OrderPaymentAllocation_tenantId_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderPaymentAllocation" RENAME CONSTRAINT "OrderPaymentAllocation_orderItem_fkey" TO "OrderPaymentAllocation_tenantId_orderItemId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderPaymentAllocation" RENAME CONSTRAINT "OrderPaymentAllocation_order_fkey" TO "OrderPaymentAllocation_tenantId_branchId_orderId_fkey";

-- RenameForeignKey
ALTER TABLE "OrderPaymentAllocation" RENAME CONSTRAINT "OrderPaymentAllocation_payment_fkey" TO "OrderPaymentAllocation_tenantId_branchId_orderPaymentId_fkey";

-- RenameForeignKey
ALTER TABLE "PrintJob" RENAME CONSTRAINT "PrintJob_branch_fkey" TO "PrintJob_tenantId_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "PrintJob" RENAME CONSTRAINT "PrintJob_order_fkey" TO "PrintJob_tenantId_branchId_orderId_fkey";

-- RenameForeignKey
ALTER TABLE "PrintJob" RENAME CONSTRAINT "PrintJob_ticket_fkey" TO "PrintJob_tenantId_kitchenTicketId_fkey";

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStock" ADD CONSTRAINT "IngredientStock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStock" ADD CONSTRAINT "IngredientStock_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStock" ADD CONSTRAINT "IngredientStock_tenantId_branchId_locationId_fkey" FOREIGN KEY ("tenantId", "branchId", "locationId") REFERENCES "InventoryLocation"("tenantId", "branchId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStock" ADD CONSTRAINT "IngredientStock_tenantId_ingredientId_fkey" FOREIGN KEY ("tenantId", "ingredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_tenantId_ingredientId_fkey" FOREIGN KEY ("tenantId", "ingredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_branchId_locationId_fkey" FOREIGN KEY ("tenantId", "branchId", "locationId") REFERENCES "InventoryLocation"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_ingredientId_fkey" FOREIGN KEY ("tenantId", "ingredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_orderItemId_fkey" FOREIGN KEY ("tenantId", "orderItemId") REFERENCES "OrderItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_tenantId_purchaseReceiptId_fkey" FOREIGN KEY ("tenantId", "purchaseReceiptId") REFERENCES "PurchaseReceipt"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientMovement" ADD CONSTRAINT "IngredientMovement_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_branchId_locationId_fkey" FOREIGN KEY ("tenantId", "branchId", "locationId") REFERENCES "InventoryLocation"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "Supplier"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_tenantId_purchaseOrderId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_tenantId_ingredientId_fkey" FOREIGN KEY ("tenantId", "ingredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_tenantId_branchId_locationId_fkey" FOREIGN KEY ("tenantId", "branchId", "locationId") REFERENCES "InventoryLocation"("tenantId", "branchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_tenantId_purchaseOrderId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PurchaseReceipt"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_tenantId_purchaseOrderItemId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_tenantId_ingredientId_fkey" FOREIGN KEY ("tenantId", "ingredientId") REFERENCES "Ingredient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "MenuModifierGroup_tenantId_branchId_productId_active_sortOrder_" RENAME TO "MenuModifierGroup_tenantId_branchId_productId_active_sortOr_idx";

-- RenameIndex
ALTER INDEX "MenuModifierOption_tenantId_branchId_groupId_active_sortOrder_i" RENAME TO "MenuModifierOption_tenantId_branchId_groupId_active_sortOrd_idx";

-- RenameIndex
ALTER INDEX "OrderPaymentAllocation_tenantId_orderPaymentId_orderItemId_gues" RENAME TO "OrderPaymentAllocation_tenantId_orderPaymentId_orderItemId__key";
