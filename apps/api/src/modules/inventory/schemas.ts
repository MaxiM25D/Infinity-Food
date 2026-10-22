import { z } from "zod";

export const idSchema = z.string().trim().min(1).max(100);
const quantity = z.coerce.number().int().min(1).max(2_000_000_000);
const nonNegative = z.coerce.number().int().min(0).max(2_000_000_000);

export const locationSchema = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(100), isDefault: z.boolean().optional().default(false) });
export const ingredientSchema = z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(120), unit: z.enum(["GRAM", "MILLILITER", "UNIT"]) });
export const stockSchema = z.object({ quantity: nonNegative, reorderPoint: nonNegative, averageCostPerThousandCents: nonNegative, note: z.string().trim().min(3).max(240) });
export const wasteSchema = z.object({ locationId: idSchema, quantity, note: z.string().trim().min(3).max(240), clientRequestId: z.string().uuid() });
export const transferSchema = z.object({ ingredientId: idSchema, fromLocationId: idSchema, toLocationId: idSchema, quantity, note: z.string().trim().min(3).max(240), clientRequestId: z.string().uuid() }).refine((value) => value.fromLocationId !== value.toLocationId, { message: "Los depósitos deben ser diferentes" });
export const recipeSchema = z.object({ ingredients: z.array(z.object({ ingredientId: idSchema, quantity })).max(100) });
export const supplierSchema = z.object({ name: z.string().trim().min(2).max(120), taxId: z.string().trim().max(40).nullish(), email: z.string().trim().email().max(180).nullish(), phone: z.string().trim().max(40).nullish(), notes: z.string().trim().max(500).nullish() });
export const purchaseOrderSchema = z.object({ supplierId: idSchema, locationId: idSchema, expectedAt: z.coerce.date().nullish(), notes: z.string().trim().max(500).nullish(), items: z.array(z.object({ ingredientId: idSchema, orderedQuantity: quantity, unitCostPerThousandInCents: nonNegative })).min(1).max(100) });
export const receiptSchema = z.object({ clientRequestId: z.string().uuid(), note: z.string().trim().max(500).nullish(), items: z.array(z.object({ purchaseOrderItemId: idSchema, quantity })).min(1).max(100) });
