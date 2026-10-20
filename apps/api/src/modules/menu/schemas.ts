import { z } from "zod";

export const publicSlugSchema = z.string().trim().toLowerCase().min(2).max(80).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "La dirección de la carta no es válida",
);

export const menuProductIdSchema = z.string().trim().min(1).max(64);

export const updateBranchMenuItemSchema = z.object({
  availability: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN"]),
  priceOverrideInCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
  featured: z.boolean(),
}).strict();
