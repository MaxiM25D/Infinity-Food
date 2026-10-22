ALTER TABLE "OrderItemModifier" DROP CONSTRAINT "OrderItemModifier_option_fkey";
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_option_fkey" FOREIGN KEY ("modifierOptionId") REFERENCES "MenuModifierOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
