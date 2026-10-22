import { Router } from "express";

import type { Prisma } from "@infinityshop/database";

import { database } from "../../database.js";
import { HttpError } from "../../errors.js";
import {
  addOrderAdjustment,
  claimPrintJob,
  closeTableGroup,
  completePrintJob,
  configureModifiers,
  createReceiptPrintJob,
  createTableGroup,
  transferDiningOrder,
} from "../../services/advanced-dining.js";
import { emitDiningUpdate } from "../../services/realtime.js";
import { getAuthContext, requireBranchRoles, requireSession } from "../auth/session.js";
import { requireWritableSubscription } from "../saas/limits.js";
import {
  adjustmentSchema,
  idSchema,
  modifierConfigurationSchema,
  printCompleteSchema,
  printQuerySchema,
  printRequestSchema,
  tableGroupSchema,
  tableTransferSchema,
} from "./schemas.js";

export const advancedDiningRouter = Router();

function printJobScope(auth: ReturnType<typeof getAuthContext>): Prisma.PrintJobWhereInput {
  if (auth.role !== "STAFF" || auth.branch.role === "MANAGER") return {};
  if (auth.branch.role === "KITCHEN") return { type: "KITCHEN", kitchenTicket: { stationId: auth.branch.stationId ?? "" } };
  if (auth.branch.role === "CASHIER") return { type: "RECEIPT" };
  return { id: "" };
}

advancedDiningRouter.use(requireSession);
advancedDiningRouter.use(requireBranchRoles("MANAGER", "WAITER", "KITCHEN", "CASHIER"));
advancedDiningRouter.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    void requireWritableSubscription(request, response, next);
    return;
  }
  next();
});

advancedDiningRouter.get("/overview", async (request, response) => {
  const auth = getAuthContext(request);
  const [tableGroups, printJobs] = await Promise.all([
    database.diningTableGroup.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id, closedAt: null },
      orderBy: { createdAt: "asc" },
      include: { primaryTable: true, members: { where: { leftAt: null }, include: { table: true }, orderBy: { joinedAt: "asc" } } },
    }),
    database.printJob.findMany({
      where: { tenantId: auth.tenant.id, branchId: auth.branch.id, status: { in: ["PENDING", "CLAIMED", "FAILED"] }, ...printJobScope(auth) },
      orderBy: { createdAt: "asc" }, take: 100,
    }),
  ]);
  response.setHeader("Cache-Control", "no-store");
  response.json({ tableGroups, printJobs });
});

advancedDiningRouter.put("/menu-items/:productId/modifiers", requireBranchRoles("MANAGER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = modifierConfigurationSchema.parse(request.body);
  const groups = await configureModifiers({
    tenantId: auth.tenant.id, branchId: auth.branch.id,
    productId: idSchema.parse(request.params.productId), groups: input.groups,
  });
  response.json({ groups });
});

advancedDiningRouter.post("/table-groups", requireBranchRoles("MANAGER", "WAITER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = tableGroupSchema.parse(request.body);
  const group = await createTableGroup({ tenantId: auth.tenant.id, branchId: auth.branch.id, userId: auth.user.id, ...input });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { tableGroupId: group.id } });
  response.status(201).json({ group });
});

advancedDiningRouter.delete("/table-groups/:groupId", requireBranchRoles("MANAGER", "WAITER"), async (request, response) => {
  const auth = getAuthContext(request);
  const group = await closeTableGroup({ tenantId: auth.tenant.id, branchId: auth.branch.id, groupId: idSchema.parse(request.params.groupId) });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { tableGroupId: group.id, closed: true } });
  response.json({ group });
});

advancedDiningRouter.patch("/orders/:orderId/table", requireBranchRoles("MANAGER", "WAITER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = tableTransferSchema.parse(request.body);
  const result = await transferDiningOrder({
    tenantId: auth.tenant.id, branchId: auth.branch.id, userId: auth.user.id,
    orderId: idSchema.parse(request.params.orderId), ...input,
  });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { orderId: request.params.orderId, transfer: true } });
  response.json(result);
});

advancedDiningRouter.post("/orders/:orderId/adjustments", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = adjustmentSchema.parse(request.body);
  const result = await addOrderAdjustment({
    tenantId: auth.tenant.id, branchId: auth.branch.id, userId: auth.user.id,
    orderId: idSchema.parse(request.params.orderId), ...input,
  });
  emitDiningUpdate({ tenantId: auth.tenant.id, branchId: auth.branch.id, event: "dining:order-updated", payload: { orderId: request.params.orderId, adjustment: true } });
  response.status(result.created ? 201 : 200).json(result);
});

advancedDiningRouter.post("/orders/:orderId/print", requireBranchRoles("MANAGER", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = printRequestSchema.parse(request.body);
  const result = await createReceiptPrintJob({
    tenantId: auth.tenant.id, branchId: auth.branch.id,
    orderId: idSchema.parse(request.params.orderId), clientRequestId: input.clientRequestId,
  });
  response.status(result.created ? 201 : 200).json(result);
});

advancedDiningRouter.get("/print-jobs", requireBranchRoles("MANAGER", "KITCHEN", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const query = printQuerySchema.parse(request.query);
  const jobs = await database.printJob.findMany({
    where: { tenantId: auth.tenant.id, branchId: auth.branch.id, status: query.status, ...printJobScope(auth) },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  response.json({ jobs });
});

advancedDiningRouter.post("/print-jobs/:jobId/claim", requireBranchRoles("MANAGER", "KITCHEN", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const jobId = idSchema.parse(request.params.jobId);
  const allowed = await database.printJob.findFirst({ where: { id: jobId, tenantId: auth.tenant.id, branchId: auth.branch.id, ...printJobScope(auth) }, select: { id: true } });
  if (!allowed) throw new HttpError(404, "Trabajo de impresión no encontrado");
  const job = await claimPrintJob({ tenantId: auth.tenant.id, branchId: auth.branch.id, jobId, userId: auth.user.id });
  response.json({ job });
});

advancedDiningRouter.post("/print-jobs/:jobId/complete", requireBranchRoles("MANAGER", "KITCHEN", "CASHIER"), async (request, response) => {
  const auth = getAuthContext(request);
  const input = printCompleteSchema.parse(request.body);
  const jobId = idSchema.parse(request.params.jobId);
  const allowed = await database.printJob.findFirst({ where: { id: jobId, tenantId: auth.tenant.id, branchId: auth.branch.id, ...printJobScope(auth) }, select: { id: true } });
  if (!allowed) throw new HttpError(404, "Trabajo de impresión no encontrado");
  const job = await completePrintJob({ tenantId: auth.tenant.id, branchId: auth.branch.id, jobId, userId: auth.user.id, ...input });
  response.json({ job });
});
