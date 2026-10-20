import { Router } from "express";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import { operationalReport } from "../../services/reports.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { reportQuerySchema } from "./schemas.js";

export const reportsRouter = Router();
reportsRouter.use(requireSession);
reportsRouter.use(requireBranchRoles("MANAGER", "CASHIER"));

reportsRouter.get("/operations", async (request, response) => {
  const auth = getAuthContext(request);
  const input = reportQuerySchema.parse(request.query);
  let branchIds: string[];
  if (auth.role === "OWNER" || auth.role === "ADMIN") {
    if (input.branchId) {
      const branch = await database.branch.findFirst({ where: { id: input.branchId, tenantId: auth.tenant.id }, select: { id: true } });
      if (!branch) throw new HttpError(404, "Sucursal no encontrada");
      branchIds = [branch.id];
    } else {
      branchIds = (await database.branch.findMany({ where: { tenantId: auth.tenant.id, status: "ACTIVE" }, select: { id: true } })).map(({ id }) => id);
    }
  } else {
    if (input.branchId && input.branchId !== auth.branch.id) throw new HttpError(403, "No tenés acceso a esa sucursal");
    branchIds = [auth.branch.id];
  }
  response.setHeader("Cache-Control", "private, no-store");
  response.json(await operationalReport({ tenantId: auth.tenant.id, branchIds, from: input.from, to: input.to }));
});
