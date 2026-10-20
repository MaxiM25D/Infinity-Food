import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { getAuthContext, requireSession } from "../auth/session.js";
import { tenantSlug } from "../auth/schemas.js";

export const tenantRouter = Router();

tenantRouter.get("/resolve/:slug", async (request, response) => {
  const slug = tenantSlug.parse(request.params.slug);
  const tenant = await database.tenant.findUnique({
    where: { slug },
    select: { name: true, slug: true, status: true },
  });

  if (!tenant || tenant.status !== "ACTIVE") throw new HttpError(404, "Tienda no encontrada");
  response.json({ tenant: { name: tenant.name, slug: tenant.slug } });
});

tenantRouter.get("/context", requireSession, (request, response) => {
  const auth = getAuthContext(request);

  response.json({
    tenant: { name: auth.tenant.name, slug: auth.tenant.slug },
    branch: auth.branch,
    role: auth.role,
  });
});
