import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { Server } from "socket.io";

import { environment } from "./config.js";
import { database } from "./database.js";
import { resolveBranchContext, sessionCookieName } from "./modules/auth/session.js";
import { branchRoom, registerRealtimeServer, stationRoom } from "./services/realtime.js";
import { websocketConnected, websocketDisconnected } from "./services/observability.js";

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function attachRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: new URL(environment.WEB_URL).origin, credentials: true },
  });
  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, sessionCookieName);
      if (!token) throw new Error("UNAUTHORIZED");
      const session = await database.authSession.findUnique({
        where: { tokenHash: createHash("sha256").update(decodeURIComponent(token)).digest("hex") },
        include: { user: true, activeTenant: true },
      });
      if (!session || session.expiresAt <= new Date() || session.activeTenant.status !== "ACTIVE") throw new Error("UNAUTHORIZED");
      const membership = await database.membership.findUnique({ where: { tenantId_userId: { tenantId: session.activeTenantId, userId: session.userId } } });
      const support = session.user.platformRole === "SUPERADMIN" && Boolean(session.supportOriginTenantId && session.supportStartedAt);
      if (!membership && !support) throw new Error("UNAUTHORIZED");
      const role = support ? "ADMIN" : membership!.role;
      const branch = await resolveBranchContext(session.activeTenantId, session.userId, role, session.activeBranchId);
      socket.data.auth = { tenantId: session.activeTenantId, branchId: branch.id, userId: session.userId, tenantRole: role, branchRole: branch.role, stationId: branch.stationId };
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });
  io.on("connection", (socket) => {
    websocketConnected();
    socket.once("disconnect", websocketDisconnected);
    const auth = socket.data.auth as { tenantId: string; branchId: string; tenantRole: string; branchRole: string | null; stationId: string | null };
    if (auth.tenantRole === "OWNER" || auth.tenantRole === "ADMIN" || auth.branchRole !== "KITCHEN") {
      socket.join(branchRoom(auth.tenantId, auth.branchId));
    }
    socket.on("kds:join", async ({ stationId }: { stationId?: string }) => {
      if (!stationId || !(auth.tenantRole === "OWNER" || auth.tenantRole === "ADMIN" || ["MANAGER", "KITCHEN"].includes(auth.branchRole ?? ""))) return;
      if (auth.tenantRole === "STAFF" && auth.branchRole === "KITCHEN" && auth.stationId !== stationId) return;
      const station = await database.kitchenStation.findFirst({ where: { id: stationId, tenantId: auth.tenantId, branchId: auth.branchId, active: true }, select: { id: true } });
      if (station) socket.join(stationRoom(auth.tenantId, auth.branchId, station.id));
    });
  });
  registerRealtimeServer(io);
  return io;
}
