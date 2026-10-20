import nodemailer, { type Transporter } from "nodemailer";

import { environment } from "../config.js";
import { HttpError } from "../errors.js";

let transporter: Transporter | null = null;

type EmailMessage = {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTransporter(): Transporter {
  if (
    !environment.SMTP_HOST ||
    !environment.SMTP_USER ||
    !environment.SMTP_PASS
  ) {
    throw new HttpError(503, "El servicio de correo no está configurado");
  }
  transporter ??= nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS },
    connectionTimeout: environment.EMAIL_SEND_TIMEOUT_MS,
    greetingTimeout: environment.EMAIL_SEND_TIMEOUT_MS,
    socketTimeout: environment.EMAIL_SEND_TIMEOUT_MS,
  });
  return transporter;
}

async function deliverEmail(input: EmailMessage): Promise<void> {
  const recipientDomain = input.to.split("@").at(-1)?.toLowerCase();
  if (
    environment.NODE_ENV !== "production" &&
    (recipientDomain?.endsWith(".test") || recipientDomain?.endsWith(".local"))
  ) {
    return;
  }

  const fromAddress = environment.EMAIL_FROM ?? environment.SMTP_FROM ?? environment.SMTP_USER;
  if (!fromAddress) throw new HttpError(503, "El remitente de correo no está configurado");
  const from = `"${input.fromName.replaceAll('"', "")}" <${fromAddress}>`;

  if (environment.EMAIL_PROVIDER === "resend") {
    if (!environment.RESEND_API_KEY) throw new HttpError(503, "Resend no está configurado");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      signal: AbortSignal.timeout(environment.EMAIL_SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend rechazó el correo (${response.status}): ${body.slice(0, 300)}`);
    }
    return;
  }

  await getTransporter().sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

async function sendAccountEmail(input: {
  to: string;
  subject: string;
  heading: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
}): Promise<void> {
  const logoUrl = new URL(
    "/infinityfood-mark.png",
    environment.WEB_URL,
  ).toString();
  await deliverEmail({
    fromName: "InfinityFood",
    to: input.to,
    subject: input.subject,
    text: `${input.heading}\n\n${input.message}\n\n${input.actionLabel}: ${input.actionUrl}\n\nSi no solicitaste esta acción, ignorá este correo.`,
    html: `<div style="background:#f5f1ed;padding:28px;font-family:Arial,sans-serif;color:#262321"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e1dad3;padding:32px"><div style="display:flex;align-items:center;gap:14px"><img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="InfinityFood" style="display:block;border-radius:14px"><p style="font-size:24px;font-weight:bold;margin:0">InfinityFood</p></div><h1 style="font-size:26px">${escapeHtml(input.heading)}</h1><p style="line-height:1.6">${escapeHtml(input.message)}</p><p style="margin:28px 0"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:13px 20px;background:#49225B;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(input.actionLabel)}</a></p><p style="font-size:12px;color:#78716c">Si no solicitaste esta acción, ignorá este correo.</p></div></div>`,
  });
}

export function sendEmailVerification(input: {
  email: string;
  firstName: string;
  token: string;
}): Promise<void> {
  const url = new URL("/verificar-email", environment.WEB_URL);
  url.searchParams.set("token", input.token);
  return sendAccountEmail({
    to: input.email,
    subject: "Verificá tu email en InfinityFood",
    heading: `Hola ${input.firstName}, verificá tu email`,
    message:
      "Confirmá que esta dirección te pertenece. El enlace vence en 24 horas y solo puede usarse una vez.",
    actionLabel: "Verificar email",
    actionUrl: url.toString(),
  });
}

export function sendPasswordResetEmail(input: {
  email: string;
  firstName: string;
  token: string;
}): Promise<void> {
  const url = new URL("/restablecer-clave", environment.WEB_URL);
  url.searchParams.set("token", input.token);
  return sendAccountEmail({
    to: input.email,
    subject: "Restablecé tu contraseña de InfinityFood",
    heading: "Restablecé tu contraseña",
    message: `Hola ${input.firstName}. Recibimos una solicitud para cambiar tu contraseña. El enlace vence en una hora.`,
    actionLabel: "Crear nueva contraseña",
    actionUrl: url.toString(),
  });
}

export function sendTeamInvitationEmail(input: {
  email: string;
  tenantName: string;
  inviterName: string;
  role: string;
  token: string;
}): Promise<void> {
  const url = new URL("/invitacion", environment.WEB_URL);
  url.searchParams.set("token", input.token);
  return sendAccountEmail({
    to: input.email,
    subject: `${input.inviterName} te invitó a ${input.tenantName}`,
    heading: `Te invitaron a ${input.tenantName}`,
    message: `${input.inviterName} te invitó a colaborar con el rol ${input.role}. La invitación vence en siete días.`,
    actionLabel: "Aceptar invitación",
    actionUrl: url.toString(),
  });
}

export async function sendShipmentEmail(input: {
  storeName: string;
  fromName?: string | null;
  storeSlug: string;
  customerName: string;
  customerEmail: string;
  orderNumber: number;
  carrier: string;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  estimatedDelivery?: Date | null;
}): Promise<void> {
  const orderUrl = `${environment.WEB_URL.replace(/\/$/, "")}/tienda/${encodeURIComponent(input.storeSlug)}`;
  const estimated = input.estimatedDelivery
    ? new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(
        input.estimatedDelivery,
      )
    : null;
  const fromName = input.fromName?.trim() || input.storeName;
  const lines = [
    `Hola ${input.customerName},`,
    "",
    `Tu pedido #${input.orderNumber} de ${input.storeName} ya fue enviado.`,
    `Transportista: ${input.carrier}`,
    input.trackingCode ? `Código de seguimiento: ${input.trackingCode}` : null,
    estimated ? `Entrega estimada: ${estimated}` : null,
    input.trackingUrl ? `Seguimiento: ${input.trackingUrl}` : null,
    "",
    `Tienda: ${orderUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  await deliverEmail({
    fromName,
    to: input.customerEmail,
    subject: `Tu pedido #${input.orderNumber} de ${input.storeName} fue enviado`,
    text: lines,
    html: `<div style="background:#f5f1ed;padding:28px;font-family:Arial,sans-serif;color:#262321"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e1dad3;padding:32px"><p style="font-size:24px;font-weight:bold">${escapeHtml(input.storeName)}</p><p>Hola ${escapeHtml(input.customerName)},</p><h1 style="font-size:26px">Tu pedido ya está en camino</h1><p><strong>Orden:</strong> #${input.orderNumber}</p><p><strong>Transportista:</strong> ${escapeHtml(input.carrier)}</p>${input.trackingCode ? `<p><strong>Seguimiento:</strong> ${escapeHtml(input.trackingCode)}</p>` : ""}${estimated ? `<p><strong>Entrega estimada:</strong> ${escapeHtml(estimated)}</p>` : ""}${input.trackingUrl ? `<p><a href="${escapeHtml(input.trackingUrl)}" style="display:inline-block;padding:12px 18px;background:#1e1e1e;color:#fff;text-decoration:none;border-radius:6px">Seguir envío</a></p>` : ""}<p><a href="${escapeHtml(orderUrl)}">Visitar ${escapeHtml(input.storeName)}</a></p></div></div>`,
  });
}

export async function sendStoreNotification(input: {
  storeName: string;
  fromName?: string | null;
  to: string;
  subject: string;
  message: string;
  actionUrl: string;
}): Promise<void> {
  const fromName = input.fromName?.trim() || input.storeName;
  const actionUrl = new URL(input.actionUrl, environment.WEB_URL).toString();
  await deliverEmail({
    fromName,
    to: input.to,
    subject: input.subject,
    text: `${input.message}\n\nVolver a la tienda: ${actionUrl}`,
    html: `<div style="background:#f5f1ed;padding:28px;font-family:Arial,sans-serif;color:#262321"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e1dad3;padding:32px"><p style="font-size:24px;font-weight:bold">${escapeHtml(input.storeName)}</p><p style="line-height:1.6">${escapeHtml(input.message)}</p><p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;background:#1e1e1e;color:#fff;text-decoration:none;border-radius:8px">Volver a la tienda</a></p></div></div>`,
  });
}
