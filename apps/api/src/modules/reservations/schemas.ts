import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usá una fecha YYYY-MM-DD").refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)), "Ingresá una fecha válida");
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|30)$/, "Elegí un horario cada 30 minutos");
const durationMinutes = z.coerce.number().int().min(30).max(240).refine((value) => value % 30 === 0, "La duración debe avanzar de a 30 minutos").default(90);

export const availabilitySchema = z.object({
  date: dateSchema,
  partySize: z.coerce.number().int().min(1).max(50),
  durationMinutes,
}).strict();

export const reservationHoldSchema = z.object({
  clientRequestId: z.string().uuid(),
  date: dateSchema,
  time: timeSchema,
  partySize: z.coerce.number().int().min(1).max(50),
  durationMinutes,
  customerName: z.string().trim().min(2).max(100),
  customerPhone: z.string().trim().min(6).max(40),
  customerEmail: z.email().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
}).strict();

export const publicTransitionSchema = z.object({
  manageToken: z.string().min(32).max(200),
  reason: z.string().trim().max(300).optional(),
}).strict();

export const adminTransitionSchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELLED", "NO_SHOW", "SEATED", "COMPLETED"]),
  reason: z.string().trim().max(300).optional(),
}).strict();

export const schedulesSchema = z.object({
  schedules: z.array(z.object({
    weekday: z.coerce.number().int().min(0).max(6),
    opensAtMinutes: z.coerce.number().int().min(0).max(1439),
    closesAtMinutes: z.coerce.number().int().min(1).max(1440),
    active: z.boolean(),
  }).strict().refine((value) => value.closesAtMinutes > value.opensAtMinutes, "El cierre debe ser posterior a la apertura")).length(7),
}).strict().refine((value) => new Set(value.schedules.map(({ weekday }) => weekday)).size === 7, "Debe haber un horario por día");

export const idSchema = z.string().trim().min(1).max(100);
export const slugSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
