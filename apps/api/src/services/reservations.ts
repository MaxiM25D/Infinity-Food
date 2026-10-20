import { createHash, randomBytes } from "node:crypto";

import type { Prisma, ReservationStatus } from "@infinityshop/database";

import { database } from "../database.js";
import { HttpError } from "../errors.js";
import { emitReservationUpdate } from "./realtime.js";

const ACTIVE_STATUSES: ReservationStatus[] = ["HOLD", "CONFIRMED", "SEATED"];
const DEFAULT_OPEN_MINUTES = 12 * 60;
const DEFAULT_CLOSE_MINUTES = 23 * 60;
const DEFAULT_SLOT_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 90;
const DEFAULT_HOLD_MINUTES = 10;

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number };

function partsAt(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function localDateTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const intended: LocalDateTime = { year: year!, month: month!, day: day!, hour: Math.floor(minutes / 60), minute: minutes % 60 };
  const wallClock = Date.UTC(intended.year, intended.month - 1, intended.day, intended.hour, intended.minute);
  let candidate = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsAt(candidate, timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate = new Date(candidate.getTime() + wallClock - represented);
  }
  const verified = partsAt(candidate, timeZone);
  if (Object.keys(intended).some((key) => intended[key as keyof LocalDateTime] !== verified[key as keyof LocalDateTime])) {
    throw new HttpError(400, "Ese horario no existe en la zona horaria de la sucursal");
  }
  return candidate;
}

function nextLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

export function localDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: localDateTimeToUtc(date, 0, timeZone), end: localDateTimeToUtc(nextLocalDate(date), 0, timeZone) };
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isOverlapConflict(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; meta?: { code?: string; message?: string } };
  const details = `${candidate.message ?? ""} ${candidate.meta?.code ?? ""} ${candidate.meta?.message ?? ""}`.toLowerCase();
  return details.includes("23p01") || details.includes("reservation_no_overlapping_active_ranges") || details.includes("exclusion constraint");
}

async function branchSchedule(tenantId: string, branchId: string, date: string) {
  const schedule = await database.reservationSchedule.findUnique({
    where: { tenantId_branchId_weekday: { tenantId, branchId, weekday: weekday(date) } },
  });
  if (schedule && !schedule.active) return null;
  return schedule ?? { opensAtMinutes: DEFAULT_OPEN_MINUTES, closesAtMinutes: DEFAULT_CLOSE_MINUTES, active: true };
}

export async function expireReservationHolds(now = new Date()): Promise<number> {
  const expired = await database.reservation.findMany({
    where: { status: "HOLD", holdExpiresAt: { lte: now } },
    select: { id: true, tenantId: true, branchId: true },
  });
  if (!expired.length) return 0;
  let count = 0;
  for (const reservation of expired) {
    const changed = await database.$transaction(async (transaction) => {
      const updated = await transaction.reservation.updateMany({
        where: { id: reservation.id, tenantId: reservation.tenantId, branchId: reservation.branchId, status: "HOLD", holdExpiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      if (!updated.count) return false;
      await transaction.reservationAudit.create({ data: { tenantId: reservation.tenantId, branchId: reservation.branchId, reservationId: reservation.id, fromStatus: "HOLD", toStatus: "EXPIRED", reason: "Hold vencido automáticamente" } });
      return true;
    });
    if (changed) {
      count += 1;
      emitReservationUpdate({ tenantId: reservation.tenantId, branchId: reservation.branchId, reservationId: reservation.id });
    }
  }
  return count;
}

function scheduleHoldExpiry(reservationId: string, expiresAt: Date): void {
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining > 2_147_000_000) return;
  const timer = setTimeout(() => { void expireReservationHolds().catch(() => undefined); }, Math.max(0, remaining + 25));
  timer.unref();
}

export async function reservationAvailability(input: {
  tenantId: string; branchId: string; timezone: string; date: string; partySize: number; durationMinutes?: number;
}) {
  const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const now = new Date();
  await expireReservationHolds(now);
  const schedule = await branchSchedule(input.tenantId, input.branchId, input.date);
  if (!schedule) return { date: input.date, timezone: input.timezone, durationMinutes, slots: [] };
  const dayStart = localDateTimeToUtc(input.date, 0, input.timezone);
  const dayEnd = localDateTimeToUtc(nextLocalDate(input.date), 0, input.timezone);
  const [tables, reservations] = await Promise.all([
    database.restaurantTable.findMany({
      where: { tenantId: input.tenantId, branchId: input.branchId, status: "AVAILABLE", minCapacity: { lte: input.partySize }, maxCapacity: { gte: input.partySize } },
      orderBy: [{ maxCapacity: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, minCapacity: true, maxCapacity: true },
    }),
    database.reservation.findMany({
      where: { tenantId: input.tenantId, branchId: input.branchId, status: { in: ACTIVE_STATUSES }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, OR: [{ status: { not: "HOLD" } }, { holdExpiresAt: { gt: now } }] },
      select: { tableId: true, startsAt: true, endsAt: true },
    }),
  ]);
  const slots = [];
  for (let minute = schedule.opensAtMinutes; minute + durationMinutes <= schedule.closesAtMinutes; minute += DEFAULT_SLOT_MINUTES) {
    let startsAt: Date;
    let endsAt: Date;
    try {
      startsAt = localDateTimeToUtc(input.date, minute, input.timezone);
      const endMinutes = minute + durationMinutes;
      endsAt = endMinutes < 1440
        ? localDateTimeToUtc(input.date, endMinutes, input.timezone)
        : localDateTimeToUtc(nextLocalDate(input.date), endMinutes - 1440, input.timezone);
    } catch { continue; }
    if (startsAt <= now) continue;
    const availableTables = tables.filter((table) => !reservations.some((reservation) => reservation.tableId === table.id && reservation.startsAt < endsAt && reservation.endsAt > startsAt));
    if (!availableTables.length) continue;
    slots.push({
      time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), availableTableCount: availableTables.length,
      availableCapacity: availableTables.reduce((sum, table) => sum + table.maxCapacity, 0), tables: availableTables,
    });
  }
  return { date: input.date, timezone: input.timezone, durationMinutes, slots };
}

export async function createReservationHold(input: {
  tenantId: string; branchId: string; timezone: string; date: string; time: string; partySize: number; durationMinutes?: number;
  holdMinutes?: number; customerName: string; customerPhone: string; customerEmail?: string | null; notes?: string | null;
  clientRequestId: string; createdByUserId?: string;
}) {
  const existing = await database.reservation.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } }, include: { table: true } });
  if (existing) return { reservation: existing, manageToken: null, created: false };
  const [hour, minute] = input.time.split(":").map(Number);
  const startMinutes = hour! * 60 + minute!;
  const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const schedule = await branchSchedule(input.tenantId, input.branchId, input.date);
  if (!schedule || startMinutes < schedule.opensAtMinutes || startMinutes + durationMinutes > schedule.closesAtMinutes || startMinutes % DEFAULT_SLOT_MINUTES !== 0) {
    throw new HttpError(409, "El horario está fuera de la disponibilidad de la sucursal");
  }
  await expireReservationHolds();
  const startsAt = localDateTimeToUtc(input.date, startMinutes, input.timezone);
  const endMinutes = startMinutes + durationMinutes;
  const endsAt = endMinutes < 1440 ? localDateTimeToUtc(input.date, endMinutes, input.timezone) : localDateTimeToUtc(nextLocalDate(input.date), endMinutes - 1440, input.timezone);
  if (startsAt <= new Date()) throw new HttpError(409, "El horario de la reserva ya pasó");
  const holdExpiresAt = new Date(Date.now() + (input.holdMinutes ?? DEFAULT_HOLD_MINUTES) * 60_000);
  const tables = await database.restaurantTable.findMany({
    where: { tenantId: input.tenantId, branchId: input.branchId, status: "AVAILABLE", minCapacity: { lte: input.partySize }, maxCapacity: { gte: input.partySize } },
    orderBy: [{ maxCapacity: "asc" }, { name: "asc" }],
  });
  for (const table of tables) {
    const manageToken = randomBytes(32).toString("base64url");
    try {
      const reservation = await database.$transaction(async (transaction) => {
        const created = await transaction.reservation.create({ data: {
          tenantId: input.tenantId, branchId: input.branchId, tableId: table.id, partySize: input.partySize,
          customerName: input.customerName, customerPhone: input.customerPhone, customerEmail: input.customerEmail,
          notes: input.notes, startsAt, endsAt, holdExpiresAt, clientRequestId: input.clientRequestId,
          manageTokenHash: tokenHash(manageToken), createdByUserId: input.createdByUserId,
        } });
        await transaction.reservationAudit.create({ data: { tenantId: input.tenantId, branchId: input.branchId, reservationId: created.id, toStatus: "HOLD", actorUserId: input.createdByUserId, reason: "Disponibilidad retenida" } });
        return transaction.reservation.findUniqueOrThrow({ where: { id: created.id }, include: { table: true } });
      });
      scheduleHoldExpiry(reservation.id, holdExpiresAt);
      return { reservation, manageToken, created: true };
    } catch (error) {
      if (isOverlapConflict(error)) continue;
      if ((error as { code?: string }).code === "P2002") {
        const repeated = await database.reservation.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } }, include: { table: true } });
        if (repeated) return { reservation: repeated, manageToken: null, created: false };
      }
      throw error;
    }
  }
  throw new HttpError(409, "Ya no quedan mesas disponibles para ese horario y capacidad");
}

export async function reservationByToken(tenantId: string, branchId: string, id: string, token: string) {
  return database.reservation.findFirst({ where: { id, tenantId, branchId, manageTokenHash: tokenHash(token) }, include: { table: true, audits: { orderBy: { createdAt: "asc" } } } });
}

export async function transitionReservation(input: {
  tenantId: string; branchId: string; reservationId: string; toStatus: Exclude<ReservationStatus, "HOLD" | "EXPIRED">;
  actorUserId?: string; reason?: string; manageToken?: string;
}) {
  const current = input.manageToken
    ? await reservationByToken(input.tenantId, input.branchId, input.reservationId, input.manageToken)
    : await database.reservation.findFirst({ where: { id: input.reservationId, tenantId: input.tenantId, branchId: input.branchId } });
  if (!current) throw new HttpError(404, "Reserva no encontrada");
  const allowed: Partial<Record<ReservationStatus, ReservationStatus[]>> = {
    HOLD: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["CANCELLED", "NO_SHOW", "SEATED"], SEATED: ["COMPLETED"],
  };
  if (current.status === "HOLD" && current.holdExpiresAt && current.holdExpiresAt <= new Date()) {
    await expireReservationHolds();
    throw new HttpError(409, "El hold venció; consultá disponibilidad nuevamente");
  }
  if (!allowed[current.status]?.includes(input.toStatus)) throw new HttpError(409, `No se puede pasar una reserva ${current.status} a ${input.toStatus}`);
  const now = new Date();
  const timestamp: Prisma.ReservationUpdateManyMutationInput = input.toStatus === "CONFIRMED" ? { confirmedAt: now, holdExpiresAt: null }
    : input.toStatus === "CANCELLED" ? { cancelledAt: now, holdExpiresAt: null }
      : input.toStatus === "NO_SHOW" ? { noShowAt: now }
        : input.toStatus === "SEATED" ? { seatedAt: now }
          : { completedAt: now };
  return database.$transaction(async (transaction) => {
    const updated = await transaction.reservation.updateMany({ where: { id: current.id, tenantId: input.tenantId, branchId: input.branchId, status: current.status }, data: { status: input.toStatus, ...timestamp } });
    if (!updated.count) throw new HttpError(409, "La reserva cambió mientras se procesaba la solicitud");
    await transaction.reservationAudit.create({ data: { tenantId: input.tenantId, branchId: input.branchId, reservationId: current.id, fromStatus: current.status, toStatus: input.toStatus, actorUserId: input.actorUserId, reason: input.reason } });
    return transaction.reservation.findUniqueOrThrow({ where: { id: current.id }, include: { table: true, audits: { orderBy: { createdAt: "asc" } } } });
  });
}

export const reservationDefaults = { durationMinutes: DEFAULT_DURATION_MINUTES, holdMinutes: DEFAULT_HOLD_MINUTES, slotMinutes: DEFAULT_SLOT_MINUTES };
