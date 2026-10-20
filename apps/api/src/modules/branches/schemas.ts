import { z } from "zod";

const slug = z.string().trim().toLowerCase().min(2).max(80).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Usá letras minúsculas, números y guiones simples",
);

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

const timezone = z.string().trim().min(3).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Ingresá una zona horaria IANA válida");

export const branchIdSchema = z.string().trim().min(1).max(64);

export const createBranchSchema = z.object({
  slug,
  name: z.string().trim().min(2).max(100),
  timezone: timezone.default("America/Argentina/Buenos_Aires"),
  address: nullableText(200),
  city: nullableText(100),
  province: nullableText(100),
  postalCode: nullableText(20),
  phone: nullableText(30),
}).strict();

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).refine((input) => Object.keys(input).length > 0, "Enviá al menos un campo");

export const assignBranchMemberSchema = z.object({
  role: z.enum(["MANAGER", "WAITER", "KITCHEN", "CASHIER", "STAFF"]),
  stationId: branchIdSchema.optional().nullable(),
}).strict().superRefine((input, context) => {
  if (input.role === "KITCHEN" && !input.stationId) context.addIssue({ code: "custom", path: ["stationId"], message: "Asigná una estación al personal de cocina o barra" });
});
