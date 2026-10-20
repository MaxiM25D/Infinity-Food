import { createHash, randomBytes } from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { BranchContext } from "@infinityfood/contracts";

import { environment } from "../../config.js";
import { database } from "../../database.js";
import { HttpError } from "../../errors.js";

export const sessionCookieName = "infinityshop_session";

export async function resolveBranchContext(
  tenantId: string,
  userId: string,
  tenantRole: "OWNER" | "ADMIN" | "STAFF",
  preferredBranchId?: string,
): Promise<BranchContext> {
  if (tenantRole === "OWNER" || tenantRole === "ADMIN") {
    const branch = await database.branch.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        ...(preferredBranchId ? { id: preferredBranchId } : {}),
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    if (!branch && preferredBranchId) {
      return resolveBranchContext(tenantId, userId, tenantRole);
    }
    if (!branch) throw new HttpError(409, "El restaurante no tiene una sucursal activa");
    return { id: branch.id, slug: branch.slug, name: branch.name, timezone: branch.timezone, role: null, stationId: null };
  }

  const access = await database.membershipBranch.findFirst({
    where: {
      tenantId,
      userId,
      branch: { status: "ACTIVE" },
      ...(preferredBranchId ? { branchId: preferredBranchId } : {}),
    },
    include: { branch: true },
    orderBy: [{ branch: { isPrimary: "desc" } }, { createdAt: "asc" }],
  });
  if (!access && preferredBranchId) {
    return resolveBranchContext(tenantId, userId, tenantRole);
  }
  if (!access) throw new HttpError(403, "No tenés acceso a una sucursal activa");
  return {
    id: access.branch.id,
    slug: access.branch.slug,
    name: access.branch.name,
    timezone: access.branch.timezone,
    role: access.role,
    stationId: access.stationId,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response: Response, token: string): void {
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: environment.SESSION_COOKIE_SAME_SITE,
    secure: environment.NODE_ENV === "production",
    domain: environment.SESSION_COOKIE_DOMAIN,
    maxAge: environment.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export async function createSession(
  response: Response,
  userId: string,
  activeTenantId: string,
): Promise<void> {
  const membership = await database.membership.findUnique({
    where: { tenantId_userId: { tenantId: activeTenantId, userId } },
  });

  if (!membership) throw new HttpError(403, "El usuario no pertenece a la tienda");
  const branch = await resolveBranchContext(activeTenantId, userId, membership.role);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + environment.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await database.$transaction([
    database.authSession.create({ data: { tokenHash: hashSessionToken(token), userId, activeTenantId, activeBranchId: branch.id, expiresAt } }),
    database.user.update({ where: { id: userId }, data: { lastTenantId: activeTenantId } }),
  ]);
  setSessionCookie(response, token);
}

export async function selectSessionTenant(sessionId: string, userId: string, tenantId: string): Promise<void> {
  const membership = await database.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!membership) throw new HttpError(403, "No tenés acceso a esa tienda");
  const branch = await resolveBranchContext(tenantId, userId, membership.role);
  await database.$transaction([
    database.authSession.update({ where: { id: sessionId }, data: { activeTenantId: tenantId, activeBranchId: branch.id } }),
    database.user.update({ where: { id: userId }, data: { lastTenantId: tenantId } }),
  ]);
}

export async function selectSessionBranch(
  sessionId: string,
  tenantId: string,
  userId: string,
  tenantRole: "OWNER" | "ADMIN" | "STAFF",
  branchId: string,
) {
  const branch = await resolveBranchContext(tenantId, userId, tenantRole, branchId);
  if (branch.id !== branchId) throw new HttpError(403, "No tenés acceso a esa sucursal activa");
  await database.authSession.update({ where: { id: sessionId }, data: { activeBranchId: branch.id } });
  return branch;
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = request.cookies?.[sessionCookieName] as string | undefined;

  if (token) {
    const session = await database.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { id: true },
    });
    if (session) {
      await database.$transaction([
        database.supportAccessLog.updateMany({
          where: { sessionId: session.id, endedAt: null },
          data: { endedAt: new Date() },
        }),
        database.authSession.delete({ where: { id: session.id } }),
      ]);
    }
  }

  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: environment.SESSION_COOKIE_SAME_SITE,
    secure: environment.NODE_ENV === "production",
    domain: environment.SESSION_COOKIE_DOMAIN,
    path: "/",
  });
}

export async function requireSession(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = request.cookies?.[sessionCookieName] as string | undefined;
    if (!token) throw new HttpError(401, "Iniciá sesión para continuar");

    const session = await database.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true, activeTenant: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await database.$transaction([
          database.supportAccessLog.updateMany({
            where: { sessionId: session.id, endedAt: null },
            data: { endedAt: new Date() },
          }),
          database.authSession.delete({ where: { id: session.id } }),
        ]);
      }
      throw new HttpError(401, "La sesión venció o no es válida");
    }

    let activeTenant = session.activeTenant;
    let activeBranchId = session.activeBranchId;
    let membership = await database.membership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.activeTenantId, userId: session.userId },
      },
    });
    const supportAccessActive =
      session.user.platformRole === "SUPERADMIN" &&
      Boolean(session.supportOriginTenantId && session.supportStartedAt);

    if ((!membership || activeTenant.status !== "ACTIVE") && !supportAccessActive) {
      const fallback = await database.membership.findFirst({
        where: { userId: session.userId, tenant: { status: "ACTIVE" } },
        include: { tenant: true },
        orderBy: { createdAt: "asc" },
      });
      if (!fallback) throw new HttpError(403, "No tenés acceso a una tienda activa");
      membership = fallback;
      activeTenant = fallback.tenant;
      const fallbackBranch = await resolveBranchContext(fallback.tenantId, session.user.id, fallback.role);
      activeBranchId = fallbackBranch.id;
      await database.$transaction([
        database.authSession.update({ where: { id: session.id }, data: { activeTenantId: fallback.tenantId, activeBranchId } }),
        database.user.update({ where: { id: session.userId }, data: { lastTenantId: fallback.tenantId } }),
      ]);
    }

    const effectiveRole = supportAccessActive ? "ADMIN" : membership!.role;
    const branch = await resolveBranchContext(activeTenant.id, session.user.id, effectiveRole, activeBranchId);
    if (branch.id !== activeBranchId) {
      await database.authSession.update({ where: { id: session.id }, data: { activeBranchId: branch.id } });
    }

    request.auth = {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        platformRole: session.user.platformRole,
        emailVerified: Boolean(session.user.emailVerifiedAt),
      },
      tenant: {
        id: activeTenant.id,
        slug: activeTenant.slug,
        name: activeTenant.name,
      },
      branch,
      role: effectiveRole,
      supportAccess: supportAccessActive
        ? {
            originTenantId: session.supportOriginTenantId!,
            startedAt: session.supportStartedAt!.toISOString(),
          }
        : null,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function getAuthContext(request: Request): NonNullable<Request["auth"]> {
  if (!request.auth) throw new HttpError(401, "Iniciá sesión para continuar");
  return request.auth;
}

export function requireRoles(
  ...allowedRoles: Array<NonNullable<Request["auth"]>["role"]>
): RequestHandler {
  return (request, _response, next) => {
    try {
      const auth = getAuthContext(request);
      if (!allowedRoles.includes(auth.role)) {
        throw new HttpError(403, "No tenés permisos para realizar esta acción");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireVerifiedEmail: RequestHandler = (request, _response, next) => {
  try {
    if (!getAuthContext(request).user.emailVerified) {
      throw new HttpError(403, "Verificá tu email para habilitar cobros, suscripciones e invitaciones");
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireDirectTenantAccess: RequestHandler = (request, _response, next) => {
  try {
    if (getAuthContext(request).supportAccess) {
      throw new HttpError(
        403,
        "Esta acción sensible debe realizarla el propietario desde su propia sesión",
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function requireBranchRoles(
  ...allowedRoles: Array<NonNullable<Request["auth"]>["branch"]["role"]>
): RequestHandler {
  return (request, _response, next) => {
    try {
      const auth = getAuthContext(request);
      if (auth.role === "OWNER" || auth.role === "ADMIN") {
        next();
        return;
      }
      if (!auth.branch.role || !allowedRoles.includes(auth.branch.role)) {
        throw new HttpError(403, "No tenés permisos para esta sucursal");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
