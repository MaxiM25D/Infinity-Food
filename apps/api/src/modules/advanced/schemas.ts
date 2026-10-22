import { z } from "zod";

const id = z.string().trim().min(1).max(100);
const requestId = z.string().uuid();
const amount = z.coerce.number().int().min(1).max(2_000_000_000);

export const idSchema = id;

export const modifierConfigurationSchema = z.object({
  groups: z.array(z.object({
    name: z.string().trim().min(2).max(80),
    minChoices: z.coerce.number().int().min(0).max(20),
    maxChoices: z.coerce.number().int().min(1).max(20),
    sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
    options: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      priceInCents: z.coerce.number().int().min(0).max(2_000_000_000),
      sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
      active: z.boolean().default(true),
    }).strict()).min(1).max(50),
  }).strict().refine((group) => group.minChoices <= group.maxChoices && group.maxChoices <= group.options.length, "La cantidad de opciones del grupo no es válida")).max(20),
}).strict();

export const tableGroupSchema = z.object({
  primaryTableId: id,
  tableIds: z.array(id).min(2).max(20),
  label: z.string().trim().max(100).optional().nullable(),
}).strict().refine((value) => value.tableIds.includes(value.primaryTableId), "La mesa principal debe formar parte del grupo")
  .refine((value) => new Set(value.tableIds).size === value.tableIds.length, "No repitas mesas");

export const tableTransferSchema = z.object({
  targetTableId: id,
  eventId: requestId,
}).strict();

export const adjustmentSchema = z.object({
  clientRequestId: requestId,
  type: z.enum(["DISCOUNT", "TIP", "COMPLIMENT"]),
  label: z.string().trim().min(2).max(100),
  reason: z.string().trim().min(3).max(300),
  amountInCents: amount,
  orderItemId: id.optional().nullable(),
}).strict();

export const printRequestSchema = z.object({ clientRequestId: requestId }).strict();
export const printQuerySchema = z.object({ status: z.enum(["PENDING", "CLAIMED", "PRINTED", "FAILED", "CANCELLED"]).default("PENDING") }).strict();
export const printCompleteSchema = z.object({
  status: z.enum(["PRINTED", "FAILED"]),
  error: z.string().trim().max(500).optional().nullable(),
}).strict().refine((value) => value.status !== "FAILED" || Boolean(value.error), "Indicá el error de impresión");
