import { z } from "zod";

const idSchema = z.string().trim().min(1).max(100);
const requestIdSchema = z.string().uuid();
const amountSchema = z.coerce.number().int().min(1).max(2_000_000_000);

export const openCashSessionSchema = z.object({
  openingCashInCents: z.coerce.number().int().min(0).max(2_000_000_000),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const closeCashSessionSchema = z.object({
  declaredCashInCents: z.coerce.number().int().min(0).max(2_000_000_000),
  note: z.string().trim().max(300).optional().nullable(),
}).strict();

export const cashMovementSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amountInCents: amountSchema,
  note: z.string().trim().min(3).max(300),
}).strict();

export const paymentSchema = z.object({
  clientRequestId: requestIdSchema,
  method: z.enum(["CASH", "CARD_EXTERNAL", "MERCADO_PAGO"]),
  amountInCents: amountSchema,
  reference: z.string().trim().max(180).optional().nullable(),
}).strict();

export const refundSchema = z.object({
  clientRequestId: requestIdSchema,
  amountInCents: amountSchema,
  note: z.string().trim().min(3).max(300),
}).strict();

export const posOrderSchema = z.object({
  clientRequestId: requestIdSchema,
  serviceMode: z.enum(["COUNTER", "TABLE"]),
  tableId: idSchema.optional().nullable(),
  customerName: z.string().trim().min(1).max(100).default("Mostrador"),
  customerPhone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(z.object({
    productId: idSchema,
    quantity: z.coerce.number().int().min(1).max(50),
    notes: z.string().trim().max(300).optional().nullable(),
  }).strict()).min(1).max(50),
}).strict().superRefine((value, context) => {
  if (value.serviceMode === "TABLE" && !value.tableId) {
    context.addIssue({ code: "custom", path: ["tableId"], message: "Seleccioná una mesa" });
  }
  if (value.serviceMode === "COUNTER" && value.tableId) {
    context.addIssue({ code: "custom", path: ["tableId"], message: "El mostrador no puede incluir una mesa" });
  }
});

export { idSchema };
