import { database } from "../database.js";
import { localDayRange } from "./reservations.js";

type Metric = { key: string; label: string; netInCents: number; grossInCents: number; refundsInCents: number; payments: number };

function addMetric(map: Map<string, Metric>, key: string, label: string, kind: "PAYMENT" | "REFUND", amountInCents: number) {
  const current = map.get(key) ?? { key, label, netInCents: 0, grossInCents: 0, refundsInCents: 0, payments: 0 };
  current.payments += 1;
  if (kind === "REFUND") current.refundsInCents += amountInCents;
  else current.grossInCents += amountInCents;
  current.netInCents = current.grossInCents - current.refundsInCents;
  map.set(key, current);
}

function localHour(date: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

function hourBand(hour: number): { key: string; label: string } {
  if (hour >= 6 && hour < 12) return { key: "MORNING", label: "06–12" };
  if (hour >= 12 && hour < 17) return { key: "MIDDAY", label: "12–17" };
  if (hour >= 17 && hour < 21) return { key: "EVENING", label: "17–21" };
  return { key: "NIGHT", label: "21–06" };
}

function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function percentile(values: number[], value: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!;
}

function durationMinutes(from: Date | null, to: Date | null): number | null {
  if (!from || !to || to < from) return null;
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function eachDate(from: string, to: string): string[] {
  const result: string[] = [];
  for (let value = new Date(`${from}T12:00:00Z`); value <= new Date(`${to}T12:00:00Z`); value = new Date(value.getTime() + 86_400_000)) result.push(value.toISOString().slice(0, 10));
  return result;
}

export async function operationalReport(input: { tenantId: string; branchIds: string[]; from: string; to: string }) {
  const branches = await database.branch.findMany({ where: { tenantId: input.tenantId, id: { in: input.branchIds } }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }], select: { id: true, name: true, slug: true, timezone: true } });
  const byBranch = new Map<string, Metric>();
  const byChannel = new Map<string, Metric>();
  const byPaymentMethod = new Map<string, Metric>();
  const byHourBand = new Map<string, Metric>();
  const kitchenStations: Array<{ branchId: string; branchName: string; stationId: string; stationName: string; tickets: number; averageQueueMinutes: number | null; averagePreparationMinutes: number | null; p50PreparationMinutes: number | null; p90PreparationMinutes: number | null; averageHandoffMinutes: number | null; averageTotalMinutes: number | null }> = [];
  const tableRotation: Array<{ branchId: string; branchName: string; services: number; averageMinutes: number | null; p90Minutes: number | null }> = [];
  const occupancy: Array<{ branchId: string; branchName: string; occupiedSeatMinutes: number; availableSeatMinutes: number; occupancyRate: number; noShows: number; completedOrSeated: number; noShowRate: number }> = [];
  const reconciliationSessions: Array<{ id: string; branchId: string; branchName: string; openedAt: Date; closedAt: Date | null; storedSalesInCents: number | null; calculatedSalesInCents: number; storedCashInCents: number | null; calculatedCashInCents: number; movementsInCents: number; expectedMovementInCents: number; reconciled: boolean }> = [];
  const orderIds = new Set<string>();

  for (const branch of branches) {
    const start = localDayRange(input.from, branch.timezone).start;
    const end = localDayRange(input.to, branch.timezone).end;
    const [payments, tickets, orders, reservations, schedules, tables, sessions] = await Promise.all([
      database.orderPayment.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, createdAt: { gte: start, lt: end } }, include: { order: { select: { diningSource: true, channel: true } } } }),
      database.kitchenTicket.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } }, include: { station: { select: { id: true, name: true } } } }),
      database.order.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, restaurantTableId: { not: null }, diningOpenedAt: { gte: start, lt: end }, diningClosedAt: { not: null } }, select: { diningOpenedAt: true, diningClosedAt: true } }),
      database.reservation.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, startsAt: { gte: start, lt: end }, status: { in: ["CONFIRMED", "NO_SHOW", "SEATED", "COMPLETED"] } }, select: { status: true, partySize: true, startsAt: true, endsAt: true, seatedAt: true, completedAt: true } }),
      database.reservationSchedule.findMany({ where: { tenantId: input.tenantId, branchId: branch.id }, select: { weekday: true, opensAtMinutes: true, closesAtMinutes: true, active: true } }),
      database.restaurantTable.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, status: "AVAILABLE" }, select: { maxCapacity: true } }),
      database.cashRegisterSession.findMany({ where: { tenantId: input.tenantId, branchId: branch.id, openedAt: { gte: start, lt: end } }, include: { payments: true, movements: true } }),
    ]);
    for (const payment of payments) {
      orderIds.add(payment.orderId);
      const channel = payment.order.diningSource ?? payment.order.channel;
      const band = hourBand(localHour(payment.createdAt, branch.timezone));
      addMetric(byBranch, branch.id, branch.name, payment.kind, payment.amountInCents);
      addMetric(byChannel, channel, channel, payment.kind, payment.amountInCents);
      addMetric(byPaymentMethod, payment.method, payment.method, payment.kind, payment.amountInCents);
      addMetric(byHourBand, band.key, band.label, payment.kind, payment.amountInCents);
    }
    const stationGroups = new Map<string, typeof tickets>();
    for (const ticket of tickets) stationGroups.set(ticket.stationId, [...(stationGroups.get(ticket.stationId) ?? []), ticket]);
    for (const [stationId, grouped] of stationGroups) {
      const queue = grouped.map((ticket) => durationMinutes(ticket.createdAt, ticket.startedAt)).filter((value): value is number => value !== null);
      const prep = grouped.map((ticket) => durationMinutes(ticket.startedAt ?? ticket.createdAt, ticket.readyAt)).filter((value): value is number => value !== null);
      const handoff = grouped.map((ticket) => durationMinutes(ticket.readyAt, ticket.servedAt)).filter((value): value is number => value !== null);
      const total = grouped.map((ticket) => durationMinutes(ticket.createdAt, ticket.servedAt)).filter((value): value is number => value !== null);
      kitchenStations.push({ branchId: branch.id, branchName: branch.name, stationId, stationName: grouped[0]!.station.name, tickets: grouped.length, averageQueueMinutes: average(queue), averagePreparationMinutes: average(prep), p50PreparationMinutes: percentile(prep, .5), p90PreparationMinutes: percentile(prep, .9), averageHandoffMinutes: average(handoff), averageTotalMinutes: average(total) });
    }
    const rotations = [
      ...orders.map((order) => durationMinutes(order.diningOpenedAt, order.diningClosedAt)),
      ...reservations.filter(({ status }) => status === "COMPLETED").map((reservation) => durationMinutes(reservation.seatedAt, reservation.completedAt)),
    ].filter((value): value is number => value !== null);
    tableRotation.push({ branchId: branch.id, branchName: branch.name, services: rotations.length, averageMinutes: average(rotations), p90Minutes: percentile(rotations, .9) });
    const scheduleByDay = new Map(schedules.map((schedule) => [schedule.weekday, schedule]));
    const totalCapacity = tables.reduce((sum, table) => sum + table.maxCapacity, 0);
    const availableSeatMinutes = eachDate(input.from, input.to).reduce((sum, date) => {
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      const schedule = scheduleByDay.get(day);
      if (schedule && !schedule.active) return sum;
      return sum + totalCapacity * ((schedule?.closesAtMinutes ?? 1380) - (schedule?.opensAtMinutes ?? 720));
    }, 0);
    const occupiedSeatMinutes = reservations.filter(({ status }) => ["SEATED", "COMPLETED"].includes(status)).reduce((sum, reservation) => sum + reservation.partySize * Math.max(0, Math.round((reservation.endsAt.getTime() - reservation.startsAt.getTime()) / 60_000)), 0);
    const noShows = reservations.filter(({ status }) => status === "NO_SHOW").length;
    const completedOrSeated = reservations.filter(({ status }) => ["SEATED", "COMPLETED"].includes(status)).length;
    occupancy.push({ branchId: branch.id, branchName: branch.name, occupiedSeatMinutes, availableSeatMinutes, occupancyRate: availableSeatMinutes ? Math.round(occupiedSeatMinutes / availableSeatMinutes * 10_000) / 100 : 0, noShows, completedOrSeated, noShowRate: noShows + completedOrSeated ? Math.round(noShows / (noShows + completedOrSeated) * 10_000) / 100 : 0 });
    for (const session of sessions) {
      const calculatedSales = session.payments.reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
      const calculatedCash = session.payments.filter(({ method }) => method === "CASH").reduce((sum, payment) => sum + (payment.kind === "REFUND" ? -payment.amountInCents : payment.amountInCents), 0);
      const movements = session.movements.reduce((sum, movement) => sum + movement.amountInCents, 0);
      const manual = session.movements.filter(({ type }) => ["INCOME", "EXPENSE", "ADJUSTMENT"].includes(type)).reduce((sum, movement) => sum + movement.amountInCents, 0);
      const expectedMovement = session.openingCashInCents + calculatedCash + manual;
      reconciliationSessions.push({ id: session.id, branchId: branch.id, branchName: branch.name, openedAt: session.openedAt, closedAt: session.closedAt, storedSalesInCents: session.salesTotalInCents, calculatedSalesInCents: calculatedSales, storedCashInCents: session.cashSalesInCents, calculatedCashInCents: calculatedCash, movementsInCents: movements, expectedMovementInCents: expectedMovement, reconciled: session.closedAt ? session.salesTotalInCents === calculatedSales && session.cashSalesInCents === calculatedCash && movements === expectedMovement : movements === expectedMovement });
    }
  }
  const total = [...byBranch.values()].reduce((result, item) => ({ netInCents: result.netInCents + item.netInCents, grossInCents: result.grossInCents + item.grossInCents, refundsInCents: result.refundsInCents + item.refundsInCents, payments: result.payments + item.payments }), { netInCents: 0, grossInCents: 0, refundsInCents: 0, payments: 0 });
  return {
    range: { from: input.from, to: input.to }, total: { ...total, orders: orderIds.size },
    sales: { byBranch: [...byBranch.values()], byChannel: [...byChannel.values()], byPaymentMethod: [...byPaymentMethod.values()], byHourBand: [...byHourBand.values()] },
    kitchen: { stations: kitchenStations }, tableRotation, occupancy,
    reconciliation: { sessions: reconciliationSessions, reconciled: reconciliationSessions.filter(({ reconciled }) => reconciled).length, differences: reconciliationSessions.filter(({ reconciled }) => !reconciled).length },
  };
}
