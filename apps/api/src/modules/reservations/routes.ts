import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { emitReservationUpdate } from "../../services/realtime.js";
import { environment } from "../../config.js";
import { dispatchTenantNotification } from "../../services/notifications.js";
import { createReservationHold, localDayRange, reservationAvailability, reservationByToken, reservationDefaults, transitionReservation } from "../../services/reservations.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import { adminTransitionSchema, availabilitySchema, depositSchema, exceptionSchema, idSchema, policySchema, publicTransitionSchema, reassignTableSchema, reservationHoldSchema, schedulesSchema, slugSchema, waitlistOfferSchema, waitlistSchema } from "./schemas.js";

export const publicReservationRouter = Router();
export const adminReservationRouter = Router();

async function publicBranch(tenantSlug: string, branchSlug: string) {
  const branch = await database.branch.findFirst({
    where: { slug: branchSlug, status: "ACTIVE", tenant: { slug: tenantSlug, status: "ACTIVE" } },
    select: { id: true, tenantId: true, name: true, slug: true, timezone: true, tenant: { select: { name: true, slug: true } } },
  });
  if (!branch) throw new HttpError(404, "Sucursal no encontrada");
  return branch;
}

publicReservationRouter.get("/:tenantSlug/:branchSlug/availability", async (request, response) => {
  const branch = await publicBranch(slugSchema.parse(request.params.tenantSlug), slugSchema.parse(request.params.branchSlug));
  const input = availabilitySchema.parse(request.query);
  response.setHeader("Cache-Control", "no-store");
  const policy = await database.reservationPolicy.findUnique({ where: { tenantId_branchId: { tenantId: branch.tenantId, branchId: branch.id } } });
  response.json({ branch: { name: branch.name, timezone: branch.timezone }, policy: policy ?? { reminderHours: 24, cancellationCutoffHours: 2, depositRequired: false, depositType: "FIXED", depositAmountInCents: 0 }, ...(await reservationAvailability({ tenantId: branch.tenantId, branchId: branch.id, timezone: branch.timezone, ...input })) });
});

publicReservationRouter.post("/:tenantSlug/:branchSlug/waitlist", async (request, response) => {
  const branch = await publicBranch(slugSchema.parse(request.params.tenantSlug), slugSchema.parse(request.params.branchSlug));
  const input = waitlistSchema.parse(request.body);
  const existing = await database.reservationWaitlistEntry.findUnique({ where: { tenantId_clientRequestId: { tenantId: branch.tenantId, clientRequestId: input.clientRequestId } } });
  if (existing) { response.json({ entry: existing, created: false }); return; }
  const entry = await database.reservationWaitlistEntry.create({ data: { tenantId: branch.tenantId, branchId: branch.id, requestedDate: new Date(`${input.date}T00:00:00.000Z`), preferredMinutes: input.preferredTime ? Number(input.preferredTime.slice(0, 2)) * 60 + Number(input.preferredTime.slice(3)) : null, partySize: input.partySize, durationMinutes: input.durationMinutes, customerName: input.customerName, customerPhone: input.customerPhone, customerEmail: input.customerEmail?.toLowerCase(), notes: input.notes, clientRequestId: input.clientRequestId } });
  emitReservationUpdate({ tenantId: branch.tenantId, branchId: branch.id });
  response.status(201).json({ entry, created: true });
});

publicReservationRouter.post("/:tenantSlug/:branchSlug/holds", async (request, response) => {
  const branch = await publicBranch(slugSchema.parse(request.params.tenantSlug), slugSchema.parse(request.params.branchSlug));
  const input = reservationHoldSchema.parse(request.body);
  const result = await createReservationHold({ tenantId: branch.tenantId, branchId: branch.id, timezone: branch.timezone, ...input });
  emitReservationUpdate({ tenantId: branch.tenantId, branchId: branch.id, reservationId: result.reservation.id });
  response.status(result.created ? 201 : 200).json({ ...result, expiresInMinutes: reservationDefaults.holdMinutes });
});

publicReservationRouter.get("/:tenantSlug/:branchSlug/:reservationId", async (request, response) => {
  const branch = await publicBranch(slugSchema.parse(request.params.tenantSlug), slugSchema.parse(request.params.branchSlug));
  const token = request.get("x-reservation-token") ?? "";
  const reservation = await reservationByToken(branch.tenantId, branch.id, idSchema.parse(request.params.reservationId), token);
  if (!reservation) throw new HttpError(404, "Reserva no encontrada");
  response.setHeader("Cache-Control", "no-store");
  response.json({ reservation });
});

for (const [path, status] of [["confirm", "CONFIRMED"], ["cancel", "CANCELLED"]] as const) {
  publicReservationRouter.post(`/:tenantSlug/:branchSlug/:reservationId/${path}`, async (request, response) => {
    const branch = await publicBranch(slugSchema.parse(request.params.tenantSlug), slugSchema.parse(request.params.branchSlug));
    const input = publicTransitionSchema.parse(request.body);
    const reservation = await transitionReservation({ tenantId: branch.tenantId, branchId: branch.id, reservationId: idSchema.parse(request.params.reservationId), toStatus: status, manageToken: input.manageToken, reason: input.reason });
    emitReservationUpdate({ tenantId: branch.tenantId, branchId: branch.id, reservationId: reservation.id });
    response.json({ reservation });
  });
}

adminReservationRouter.use(requireSession);
adminReservationRouter.use(requireBranchRoles("MANAGER", "WAITER"));

adminReservationRouter.get("/overview", async (request, response) => {
  const auth = getAuthContext(request);
  const date = availabilitySchema.shape.date.parse(request.query.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: auth.branch.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const range = localDayRange(date, auth.branch.timezone);
  const [reservations, tables, schedules, policy, exceptions, waitlist] = await Promise.all([
    database.reservation.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, startsAt: { gte: range.start, lt: range.end } }, orderBy: { startsAt: "asc" }, take: 250, include: { table: true, deposits: true, audits: { orderBy: { createdAt: "asc" } } } }),
    database.restaurantTable.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: [{ maxCapacity: "asc" }, { name: "asc" }] }),
    database.reservationSchedule.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { weekday: "asc" } }),
    database.reservationPolicy.findUnique({ where: { tenantId_branchId: { tenantId: auth.tenant.id, branchId: auth.branch.id } } }),
    database.reservationScheduleException.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, date: { gte: range.start } }, orderBy: { date: "asc" }, take: 60 }),
    database.reservationWaitlistEntry.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, requestedDate: { gte: new Date(`${date}T00:00:00.000Z`) }, status: { in: ["WAITING", "OFFERED"] } }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  response.setHeader("Cache-Control", "no-store");
  response.json({ date, timezone: auth.branch.timezone, reservations, tables, schedules, policy: policy ?? { reminderHours: 24, cancellationCutoffHours: 2, depositRequired: false, depositType: "FIXED", depositAmountInCents: 0 }, exceptions, waitlist, defaults: reservationDefaults });
});

adminReservationRouter.get("/availability", async (request, response) => {
  const auth = getAuthContext(request);
  const input = availabilitySchema.parse(request.query);
  response.json(await reservationAvailability({ tenantId: auth.tenant.id, branchId: auth.branch.id, timezone: auth.branch.timezone, ...input }));
});

adminReservationRouter.post("/holds", requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = reservationHoldSchema.parse(request.body);
  const result = await createReservationHold({ tenantId: auth.tenant.id, branchId: auth.branch.id, timezone: auth.branch.timezone, createdByUserId: auth.user.id, ...input });
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId: result.reservation.id });
  response.status(result.created ? 201 : 200).json(result);
});

adminReservationRouter.patch("/:reservationId/status", requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = adminTransitionSchema.parse(request.body);
  const reservation = await transitionReservation({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId: idSchema.parse(request.params.reservationId), toStatus: input.status, actorUserId: auth.user.id, reason: input.reason });
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId: reservation.id });
  response.json({ reservation });
});

adminReservationRouter.put("/schedules", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request);
  const input = schedulesSchema.parse(request.body);
  await database.$transaction(input.schedules.map((schedule) => database.reservationSchedule.upsert({
    where: { tenantId_branchId_weekday: { tenantId: auth.tenant.id, branchId: auth.branch.id, weekday: schedule.weekday } },
    update: schedule, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...schedule },
  })));
  const schedules = await database.reservationSchedule.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { weekday: "asc" } });
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id });
  response.json({ schedules });
});

adminReservationRouter.put("/policy", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const input = policySchema.parse(request.body);
  const policy = await database.reservationPolicy.upsert({ where: { tenantId_branchId: { tenantId: auth.tenant.id, branchId: auth.branch.id } }, update: input, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input } });
  response.json({ policy });
});

adminReservationRouter.put("/exceptions", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const input = exceptionSchema.parse(request.body); const date = new Date(`${input.date}T00:00:00.000Z`);
  const exception = await database.reservationScheduleException.upsert({ where: { tenantId_branchId_date: { tenantId: auth.tenant.id, branchId: auth.branch.id, date } }, update: { ...input, date }, create: { tenantId: auth.tenant.id, branchId: auth.branch.id, ...input, date } });
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id }); response.json({ exception });
});

adminReservationRouter.delete("/exceptions/:id", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const id = idSchema.parse(request.params.id);
  const removed = await database.reservationScheduleException.deleteMany({ where: { id, tenantId: auth.tenant.id, branchId: auth.branch.id } });
  if (!removed.count) throw new HttpError(404, "Excepción no encontrada");
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id }); response.status(204).send();
});

adminReservationRouter.post("/:reservationId/deposits", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const reservationId = idSchema.parse(request.params.reservationId); const input = depositSchema.parse(request.body);
  const result = await database.$transaction(async (transaction) => {
    const duplicate = await transaction.reservationDeposit.findUnique({ where: { tenantId_clientRequestId: { tenantId: auth.tenant.id, clientRequestId: input.clientRequestId } } });
    if (duplicate) {
      if (duplicate.reservationId !== reservationId || duplicate.branchId !== auth.branch.id) throw new HttpError(409, "La clave idempotente ya fue usada para otra seña");
      return { deposit: duplicate, changed: false };
    }
    await transaction.$queryRaw`SELECT "id" FROM "Reservation" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "id" = ${reservationId} FOR UPDATE`;
    const reservation = await transaction.reservation.findFirst({ where: { id: reservationId, tenantId: auth.tenant.id, branchId: auth.branch.id, status: "HOLD" } });
    if (!reservation) throw new HttpError(409, "La reserva no admite una seña");
    const pending = await transaction.reservationDeposit.findFirst({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId, status: "PENDING" } });
    if (!pending) throw new HttpError(409, "La reserva no tiene una seña pendiente");
    if (pending.amountInCents !== input.amountInCents) throw new HttpError(409, `La seña requerida es de ${pending.amountInCents} centavos`);
    const deposit = await transaction.reservationDeposit.update({ where: { id: pending.id }, data: { status: "PAID", method: input.method, reference: input.reference, receivedByUserId: auth.user.id, paidAt: new Date(), clientRequestId: input.clientRequestId } });
    return { deposit, changed: true };
  }, { isolationLevel: "Serializable" });
  let reservation = null;
  if (result.changed) reservation = await transitionReservation({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId, toStatus: "CONFIRMED", actorUserId: auth.user.id, reason: "Confirmación automática por seña registrada" });
  else {
    const current = await database.reservation.findFirst({ where: { id: reservationId, tenantId: auth.tenant.id, branchId: auth.branch.id }, include: { deposits: true } });
    if (current?.status === "HOLD" && result.deposit.status === "PAID" && !current.deposits.some(({ status }) => status === "PENDING")) reservation = await transitionReservation({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId, toStatus: "CONFIRMED", actorUserId: auth.user.id, reason: "Confirmación recuperada por reintento de seña" });
    else reservation = current;
  }
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId }); response.status(result.changed ? 201 : 200).json({ ...result, reservation });
});

adminReservationRouter.patch("/:reservationId/table", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const reservationId = idSchema.parse(request.params.reservationId); const input = reassignTableSchema.parse(request.body);
  try {
    const reservation = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Reservation" WHERE "tenantId" = ${auth.tenant.id} AND "branchId" = ${auth.branch.id} AND "id" = ${reservationId} FOR UPDATE`;
      const current = await transaction.reservation.findFirst({ where: { id: reservationId, tenantId: auth.tenant.id, branchId: auth.branch.id, status: { in: ["HOLD", "CONFIRMED"] } } });
      const table = await transaction.restaurantTable.findFirst({ where: { id: input.tableId, tenantId: auth.tenant.id, branchId: auth.branch.id, status: "AVAILABLE" } });
      if (!current || !table) throw new HttpError(404, "Reserva o mesa no encontrada");
      if (table.maxCapacity < current.partySize || table.minCapacity > current.partySize) throw new HttpError(409, "La capacidad de la mesa no es adecuada");
      const updated = await transaction.reservation.update({ where: { id: current.id }, data: { tableId: table.id }, include: { table: true } });
      await transaction.reservationAudit.create({ data: { tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId: current.id, fromStatus: current.status, toStatus: current.status, actorUserId: auth.user.id, reason: `Mesa reasignada a ${table.name}` } });
      return updated;
    }, { isolationLevel: "Serializable" });
    emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId }); response.json({ reservation });
  } catch (error) {
    if (`${(error as { message?: string }).message}`.includes("reservation_no_overlapping_active_ranges")) throw new HttpError(409, "La mesa ya está reservada en ese horario");
    throw error;
  }
});

adminReservationRouter.post("/waitlist/:id/offer", requireBranchRoles("MANAGER"), requireWritableSubscription, async (request, response) => {
  const auth = getAuthContext(request); const id = idSchema.parse(request.params.id); const input = waitlistOfferSchema.parse(request.body);
  const entry = await database.reservationWaitlistEntry.findFirst({ where: { id, tenantId: auth.tenant.id, branchId: auth.branch.id, status: "WAITING" } });
  if (!entry) throw new HttpError(404, "Solicitud de lista de espera no encontrada");
  const date = entry.requestedDate.toISOString().slice(0, 10);
  const held = await createReservationHold({ tenantId: auth.tenant.id, branchId: auth.branch.id, timezone: auth.branch.timezone, date, time: input.time, partySize: entry.partySize, durationMinutes: entry.durationMinutes, holdMinutes: input.holdMinutes, customerName: entry.customerName, customerPhone: entry.customerPhone, customerEmail: entry.customerEmail, notes: entry.notes, clientRequestId: entry.clientRequestId, createdByUserId: auth.user.id });
  const updated = await database.reservationWaitlistEntry.update({ where: { id: entry.id }, data: { status: "OFFERED", reservationId: held.reservation.id, offerExpiresAt: held.reservation.holdExpiresAt } });
  if (entry.customerEmail && held.manageToken) {
    const url = new URL(`/reservas/${auth.tenant.slug}/${auth.branch.slug}`, environment.WEB_URL); url.searchParams.set("reservation", held.reservation.id); url.searchParams.set("token", held.manageToken);
    await dispatchTenantNotification({ tenantId: auth.tenant.id, reservationId: held.reservation.id, event: "RESERVATION_WAITLIST_OFFER", recipient: entry.customerEmail, actionUrl: url.toString() });
  }
  emitReservationUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, reservationId: held.reservation.id }); response.status(201).json({ entry: updated, ...held });
});
