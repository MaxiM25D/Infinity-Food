import type { NotificationEvent } from "@infinityshop/database";

import { environment } from "../config.js";
import { database } from "../database.js";
import { sendStoreNotification } from "./mail.js";

const defaults: Record<NotificationEvent, { subject: (store: string) => string; message: string }> = {
  ORDER_CREATED: { subject: (store) => `Recibimos tu pedido en ${store}`, message: "Tu pedido fue creado correctamente. Te avisaremos cuando cambie su estado." },
  ORDER_PAID: { subject: (store) => `Pago confirmado en ${store}`, message: "Confirmamos el pago de tu pedido. Ya estamos trabajando para prepararlo." },
  ORDER_SHIPPED: { subject: (store) => `Tu pedido de ${store} fue enviado`, message: "Tu compra ya está en camino." },
  ORDER_READY_FOR_PICKUP: { subject: (store) => `Tu pedido de ${store} está listo para retirar`, message: "Tu compra ya está preparada. Revisá el punto de retiro, los horarios y las indicaciones antes de acercarte." },
  CART_ABANDONED: { subject: (store) => `Tu carrito te espera en ${store}`, message: "Guardamos los productos que elegiste para que puedas completar tu compra." },
  RESERVATION_CONFIRMED: { subject: (store) => `Tu reserva en ${store} está confirmada`, message: "Confirmamos tu mesa. Guardá este correo y avisá al local si necesitás hacer un cambio." },
  RESERVATION_REMINDER: { subject: (store) => `Recordatorio de tu reserva en ${store}`, message: "Tu reserva se acerca. Revisá los datos y avisá si no vas a poder asistir." },
  RESERVATION_WAITLIST_OFFER: { subject: (store) => `Se liberó una mesa en ${store}`, message: "Tenemos una mesa para tu solicitud. Confirmala desde el enlace antes de que venza la oferta." },
};

export async function dispatchTenantNotification(input: { tenantId: string; event: NotificationEvent; recipient: string; actionUrl: string; orderId?: string; reservationId?: string; nextAttemptAt?: Date }): Promise<{ id: string } | null> {
  const tenant = await database.tenant.findUnique({
    where: { id: input.tenantId },
    include: { notificationRules: { where: { event: input.event } } },
  });
  if (!tenant) return null;
  const rule = tenant.notificationRules[0];
  if (rule && !rule.active) return null;
  try {
    return await database.notificationLog.create({
      data: {
        tenantId: input.tenantId, orderId: input.orderId, reservationId: input.reservationId, event: input.event,
        recipient: input.recipient, subject: rule?.subject ?? defaults[input.event].subject(tenant.name),
        message: rule?.message ?? defaults[input.event].message, actionUrl: input.actionUrl,
        status: "PENDING", nextAttemptAt: input.nextAttemptAt ?? new Date(),
      }, select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002" && input.reservationId) return database.notificationLog.findFirst({ where: { tenantId: input.tenantId, reservationId: input.reservationId, event: input.event }, select: { id: true } });
    throw error;
  }
}

export async function processPendingNotifications(batchSize = 20): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  await database.notificationLog.updateMany({
    where: {
      status: "SENDING",
      OR: [
        { lockedAt: null },
        { lockedAt: { lte: new Date(now.getTime() - 10 * 60_000) } },
      ],
      attempts: { lt: environment.EMAIL_QUEUE_MAX_ATTEMPTS },
    },
    data: { status: "FAILED", lockedAt: null, nextAttemptAt: now, error: "Envío interrumpido; se reintentará" },
  });
  const pending = await database.notificationLog.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: environment.EMAIL_QUEUE_MAX_ATTEMPTS }, nextAttemptAt: { lte: now }, subject: { not: "" } },
    include: { tenant: { include: { settings: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: batchSize,
  });
  let sent = 0;
  let failed = 0;
  for (const notification of pending) {
    const claimed = await database.notificationLog.updateMany({
      where: { id: notification.id, status: { in: ["PENDING", "FAILED"] }, attempts: notification.attempts },
      data: { status: "SENDING", lockedAt: new Date(), attempts: { increment: 1 }, error: null },
    });
    if (claimed.count !== 1) continue;
    const attempt = notification.attempts + 1;
    try {
      await sendStoreNotification({
        storeName: notification.tenant.name,
        fromName: notification.tenant.settings?.emailFromName,
        to: notification.recipient,
        subject: notification.subject,
        message: notification.message,
        actionUrl: notification.actionUrl,
      });
      await database.notificationLog.update({ where: { id: notification.id }, data: { status: "SENT", sentAt: new Date(), lockedAt: null, error: null, actionUrl: "" } });
      sent += 1;
    } catch (error) {
      const delayMinutes = Math.min(60, 2 ** Math.max(0, attempt - 1));
      await database.notificationLog.update({
        where: { id: notification.id },
        data: { status: "FAILED", lockedAt: null, nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000), error: error instanceof Error ? error.message.slice(0, 300) : "Error de envío" },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}
