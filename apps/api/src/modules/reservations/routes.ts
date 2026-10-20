import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { emitReservationUpdate } from "../../services/realtime.js";
import { createReservationHold, localDayRange, reservationAvailability, reservationByToken, reservationDefaults, transitionReservation } from "../../services/reservations.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import { adminTransitionSchema, availabilitySchema, idSchema, publicTransitionSchema, reservationHoldSchema, schedulesSchema, slugSchema } from "./schemas.js";

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
  response.json({ branch: { name: branch.name, timezone: branch.timezone }, ...(await reservationAvailability({ tenantId: branch.tenantId, branchId: branch.id, timezone: branch.timezone, ...input })) });
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
  const [reservations, tables, schedules] = await Promise.all([
    database.reservation.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id, startsAt: { gte: range.start, lt: range.end } }, orderBy: { startsAt: "asc" }, take: 250, include: { table: true, audits: { orderBy: { createdAt: "asc" } } } }),
    database.restaurantTable.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: [{ maxCapacity: "asc" }, { name: "asc" }] }),
    database.reservationSchedule.findMany({ where: { tenantId: auth.tenant.id, branchId: auth.branch.id }, orderBy: { weekday: "asc" } }),
  ]);
  response.setHeader("Cache-Control", "no-store");
  response.json({ date, timezone: auth.branch.timezone, reservations, tables, schedules, defaults: reservationDefaults });
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
