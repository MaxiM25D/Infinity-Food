import type { FiscalDocumentType } from "@infinityshop/database";

import { environment } from "../config.js";
import { database } from "../database.js";
import { HttpError } from "../errors.js";

type IssueInput = {
  tenantId: string; branchId: string; orderId: string; clientRequestId: string;
  type: FiscalDocumentType; relatedDocumentId?: string | null; amountInCents?: number;
  recipientTaxId?: string | null; recipientName?: string | null;
};

async function providerIssue(body: Record<string, unknown>, clientRequestId: string) {
  if (!environment.FISCAL_PROVIDER_URL || !environment.FISCAL_PROVIDER_TOKEN) throw new HttpError(503, "El proveedor fiscal homologado no está configurado");
  const response = await fetch(`${environment.FISCAL_PROVIDER_URL.replace(/\/$/, "")}/documents`, { method: "POST", headers: { Authorization: `Bearer ${environment.FISCAL_PROVIDER_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": clientRequestId }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { id?: string; number?: number; authorizationCode?: string; authorizationExpiresAt?: string; message?: string } | null;
  if (!response.ok || !result?.id || !result.number || !result.authorizationCode) throw new HttpError(502, result?.message ?? "El proveedor fiscal rechazó el comprobante");
  return result;
}

export async function issueFiscalDocument(input: IssueInput) {
  const duplicate = await database.fiscalDocument.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
  if (duplicate) {
    if (duplicate.branchId !== input.branchId || duplicate.orderId !== input.orderId || duplicate.type !== input.type) throw new HttpError(409, "El identificador fiscal ya fue utilizado");
    return { document: duplicate, created: false };
  }
  const profile = await database.fiscalProfile.findUnique({ where: { tenantId_branchId: { tenantId: input.tenantId, branchId: input.branchId } } });
  if (!profile?.enabled || profile.provider !== "EXTERNAL") throw new HttpError(409, "Configurá y habilitá el perfil fiscal de la sucursal");
  const order = await database.order.findFirst({ where: { id: input.orderId, tenantId: input.tenantId, branchId: input.branchId }, include: { items: true } });
  if (!order) throw new HttpError(404, "Pedido no encontrado");
  if (input.type === "INVOICE" && !["APPROVED", "PARTIALLY_PAID"].includes(order.paymentStatus)) throw new HttpError(409, "El pedido todavía no tiene un pago para facturar");
  let related = null;
  let totalInCents = order.totalInCents;
  if (input.type === "CREDIT_NOTE") {
    if (!input.relatedDocumentId) throw new HttpError(400, "Seleccioná la factura que se ajustará");
    related = await database.fiscalDocument.findFirst({ where: { id: input.relatedDocumentId, tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, type: "INVOICE", status: "ISSUED" }, include: { creditNotes: { where: { status: "ISSUED" }, select: { totalInCents: true } } } });
    if (!related) throw new HttpError(404, "Factura original no encontrada");
    const available = related.totalInCents - related.creditNotes.reduce((sum, note) => sum + note.totalInCents, 0);
    totalInCents = input.amountInCents ?? available;
    if (totalInCents < 1 || totalInCents > available) throw new HttpError(409, "La nota de crédito supera el saldo de la factura");
  }
  let pending;
  try {
    pending = await database.fiscalDocument.create({ data: { tenantId: input.tenantId, branchId: input.branchId, orderId: input.orderId, type: input.type, clientRequestId: input.clientRequestId, relatedDocumentId: related?.id, pointOfSale: profile.pointOfSale, totalInCents, currency: order.currency, recipientTaxId: input.recipientTaxId, recipientName: input.recipientName } });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await database.fiscalDocument.findUnique({ where: { tenantId_clientRequestId: { tenantId: input.tenantId, clientRequestId: input.clientRequestId } } });
    if (!raced || raced.branchId !== input.branchId || raced.orderId !== input.orderId || raced.type !== input.type) throw new HttpError(409, "El identificador fiscal ya fue utilizado");
    return { document: raced, created: false };
  }
  try {
    const issued = await providerIssue({ type: input.type, pointOfSale: profile.pointOfSale, taxId: profile.taxId, legalName: profile.legalName, taxCondition: profile.taxCondition, currency: order.currency, total: totalInCents / 100, recipient: { taxId: input.recipientTaxId, name: input.recipientName }, relatedProviderDocumentId: related?.providerDocumentId, items: order.items.map((item) => ({ sku: item.sku, description: item.productName, quantity: item.quantity, unitPrice: item.unitPriceInCents / 100, subtotal: item.subtotalInCents / 100 })) }, input.clientRequestId);
    const document = await database.fiscalDocument.update({ where: { id: pending.id }, data: { status: "ISSUED", providerDocumentId: issued.id, documentNumber: issued.number, authorizationCode: issued.authorizationCode, authorizationExpiresAt: issued.authorizationExpiresAt ? new Date(issued.authorizationExpiresAt) : null, providerResponse: issued, issuedAt: new Date() } });
    return { document, created: true };
  } catch (error) {
    await database.fiscalDocument.update({ where: { id: pending.id }, data: { status: "REJECTED", rejectionReason: error instanceof Error ? error.message.slice(0, 500) : "Rechazado", providerResponse: { failed: true } } });
    throw error;
  }
}

export function fiscalCsv(documents: Array<{ type: string; status: string; pointOfSale: number; documentNumber: number | null; totalInCents: number; currency: string; authorizationCode: string | null; issuedAt: Date | null; order: { number: number } }>) {
  const rows = [["tipo", "estado", "punto_venta", "numero", "pedido", "total", "moneda", "autorizacion", "emitido"], ...documents.map((item) => [item.type, item.status, String(item.pointOfSale), String(item.documentNumber ?? ""), String(item.order.number), (item.totalInCents / 100).toFixed(2), item.currency, item.authorizationCode ?? "", item.issuedAt?.toISOString() ?? ""])];
  return rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
}
