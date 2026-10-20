import type { Server } from "socket.io";

let realtimeServer: Server | null = null;

export function registerRealtimeServer(server: Server): void {
  realtimeServer = server;
}

export function branchRoom(tenantId: string, branchId: string): string {
  return `branch:${tenantId}:${branchId}`;
}

export function stationRoom(tenantId: string, branchId: string, stationId: string): string {
  return `station:${tenantId}:${branchId}:${stationId}`;
}

export function emitDiningUpdate(input: {
  tenantId: string;
  branchId: string;
  stationIds?: string[];
  event: "dining:order-updated" | "kds:ticket-updated";
  payload: unknown;
}): void {
  realtimeServer?.to(branchRoom(input.tenantId, input.branchId)).emit(input.event, input.payload);
  for (const stationId of input.stationIds ?? []) {
    realtimeServer?.to(stationRoom(input.tenantId, input.branchId, stationId)).emit(input.event, input.payload);
  }
}

export function emitReservationUpdate(input: { tenantId: string; branchId: string; reservationId?: string }): void {
  realtimeServer?.to(branchRoom(input.tenantId, input.branchId)).emit("reservation:updated", { reservationId: input.reservationId ?? null });
}
