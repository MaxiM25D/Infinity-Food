import { z } from "zod";

export const slugSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const idSchema = z.string().trim().min(1).max(100);
export const requestIdSchema = z.string().uuid();

export const diningItemsSchema = z.array(z.object({
  productId: idSchema,
  quantity: z.coerce.number().int().min(1).max(50),
  notes: z.string().trim().max(300).optional().nullable(),
  preparationPoint: z.string().trim().max(80).optional().nullable(),
  modifierOptionIds: z.array(idSchema).max(30).default([]),
}).strict()).min(1).max(50);

export const publicDiningOrderSchema = z.object({
  clientRequestId: requestIdSchema,
  customerName: z.string().trim().min(1).max(100),
  customerPhone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: diningItemsSchema,
}).strict();

export const waiterDiningOrderSchema = publicDiningOrderSchema.extend({
  tableId: idSchema,
});

export const diningRoundSchema = z.object({
  clientRequestId: requestIdSchema,
  orderToken: z.string().uuid().optional(),
  items: diningItemsSchema,
}).strict();

export const stationSchema = z.object({
  name: z.string().trim().min(2).max(60),
  type: z.enum(["KITCHEN", "BAR", "DESSERT", "OTHER"]).default("KITCHEN"),
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export const stationAssignmentSchema = z.object({
  stationId: idSchema,
}).strict();

export const restaurantTableSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(60),
  maxCapacity: z.coerce.number().int().min(1).max(100),
  sectorId: idSchema.optional().nullable(),
}).strict();

export const ticketStatusSchema = z.object({
  status: z.enum(["PREPARING", "READY", "SERVED", "CANCELLED"]),
  eventId: requestIdSchema,
}).strict();

export const diningOrderStatusSchema = z.object({
  status: z.enum(["SERVED", "CLOSED", "CANCELLED"]),
  eventId: requestIdSchema,
}).strict();
