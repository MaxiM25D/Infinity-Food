import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)), "Ingresá una fecha válida");

export const reportQuerySchema = z.object({
  from: date,
  to: date,
  branchId: z.string().trim().min(1).max(100).optional(),
}).strict().refine((value) => value.from <= value.to, { path: ["to"], message: "La fecha final debe ser posterior a la inicial" }).refine((value) => {
  const days = (Date.parse(`${value.to}T12:00:00Z`) - Date.parse(`${value.from}T12:00:00Z`)) / 86_400_000;
  return days <= 366;
}, { path: ["to"], message: "El rango máximo es de 366 días" });
