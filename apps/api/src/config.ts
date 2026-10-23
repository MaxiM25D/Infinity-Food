import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { z } from "zod";

const applicationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

config({ path: resolve(applicationDirectory, "../../.env") });

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalText = z.preprocess(
  emptyAsUndefined,
  z.string().trim().min(1).optional(),
);
const optionalSecret = z.preprocess(
  emptyAsUndefined,
  z.string().min(1).optional(),
);
const optionalEmail = z.preprocess(emptyAsUndefined, z.email().optional());
const optionalCookieDomain = z.preprocess(
  emptyAsUndefined,
  z
    .string()
    .trim()
    .regex(/^\.?[a-z0-9.-]+$/i)
    .optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    PORT: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    APP_VERSION: z.string().trim().default("development"),
    API_PUBLIC_URL: z.url().default("http://localhost:4000"),
    WEB_URL: z.url().default("http://localhost:3000"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    METRICS_TOKEN: optionalSecret,
    INSTANCE_ID: optionalText,
    PILOT_SIGNUP_MODE: z
      .enum(["open", "allowlist", "closed"])
      .default("open"),
    PILOT_ALLOWED_EMAILS: z.string().default(""),
    REDIS_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
    REDIS_KEY_PREFIX: z.string().trim().min(1).max(80).default("infinityfood"),
    WORKER_HEARTBEAT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(300)
      .default(30),
    REPORT_AGGREGATE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(5_000),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    SESSION_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    SESSION_COOKIE_DOMAIN: optionalCookieDomain,
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(10)
      .max(1440)
      .default(60),
    TEAM_INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
    EMAIL_FROM: optionalEmail,
    EMAIL_SEND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(30_000)
      .default(8_000),
    EMAIL_QUEUE_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
    EMAIL_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    RESEND_API_KEY: optionalSecret,
    MP_CLIENT_ID: optionalText,
    MP_CLIENT_SECRET: optionalText,
    MP_WEBHOOK_SECRET: optionalText,
    MP_TOKEN_ENCRYPTION_KEY: z.preprocess(
      emptyAsUndefined,
      z.string().min(32).optional(),
    ),
    SAAS_BILLING_PROVIDER: z
      .enum(["disabled", "mercado_pago"])
      .default("disabled"),
    SAAS_MP_ACCESS_TOKEN: optionalSecret,
    SAAS_MP_WEBHOOK_SECRET: optionalSecret,
    FISCAL_PROVIDER_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
    FISCAL_PROVIDER_TOKEN: optionalSecret,
    SMTP_HOST: optionalText,
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: z
      .string()
      .default("true")
      .transform((value) => value === "true"),
    SMTP_USER: optionalText,
    SMTP_PASS: optionalSecret,
    SMTP_FROM: optionalEmail,
    CLOUDINARY_NAME: optionalText,
    CLOUDINARY_KEY: optionalText,
    CLOUDINARY_SECRET: optionalText,
    STORAGE_PROVIDER: z.enum(["local", "cloudinary"]).default("local"),
    PUBLIC_UPLOAD_DIR: z.string().default("storage/public"),
    PRIVATE_UPLOAD_DIR: z.string().default("storage/private"),
    RESERVATION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(60_000),
  })
  .superRefine((value, context) => {
    if (value.PILOT_SIGNUP_MODE === "allowlist") {
      const allowedEmails = value.PILOT_ALLOWED_EMAILS.split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      if (
        allowedEmails.length === 0 ||
        allowedEmails.some((email) => !z.email().safeParse(email).success)
      )
        context.addIssue({
          code: "custom",
          path: ["PILOT_ALLOWED_EMAILS"],
          message: "Definí una lista de emails válidos para el piloto",
        });
    }
    if (value.NODE_ENV !== "production") return;
    if (!value.API_PUBLIC_URL.startsWith("https://"))
      context.addIssue({
        code: "custom",
        path: ["API_PUBLIC_URL"],
        message: "Debe usar HTTPS en producción",
      });
    if (!value.WEB_URL.startsWith("https://"))
      context.addIssue({
        code: "custom",
        path: ["WEB_URL"],
        message: "Debe usar HTTPS en producción",
      });
    if (!value.REDIS_URL)
      context.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "Es obligatorio para operar con múltiples réplicas",
      });
    if (value.EMAIL_PROVIDER === "resend") {
      for (const key of ["RESEND_API_KEY", "EMAIL_FROM"] as const) {
        if (!value[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Es obligatoria para usar Resend en producción",
          });
      }
    } else {
      for (const key of [
        "SMTP_HOST",
        "SMTP_USER",
        "SMTP_PASS",
        "SMTP_FROM",
      ] as const) {
        if (!value[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Es obligatoria para usar SMTP en producción",
          });
      }
    }
    if (value.STORAGE_PROVIDER === "cloudinary") {
      for (const key of [
        "CLOUDINARY_NAME",
        "CLOUDINARY_KEY",
        "CLOUDINARY_SECRET",
      ] as const) {
        if (!value[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Es obligatoria cuando STORAGE_PROVIDER=cloudinary",
          });
      }
    }
    const mercadoPagoConfigured = Boolean(
      value.MP_CLIENT_ID || value.MP_CLIENT_SECRET || value.MP_WEBHOOK_SECRET,
    );
    if (mercadoPagoConfigured) {
      for (const key of [
        "MP_CLIENT_ID",
        "MP_CLIENT_SECRET",
        "MP_WEBHOOK_SECRET",
        "MP_TOKEN_ENCRYPTION_KEY",
      ] as const) {
        if (!value[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Completá todas las credenciales de Mercado Pago",
          });
      }
    }
    if (value.SAAS_BILLING_PROVIDER === "mercado_pago") {
      for (const key of [
        "SAAS_MP_ACCESS_TOKEN",
        "SAAS_MP_WEBHOOK_SECRET",
      ] as const) {
        if (!value[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message:
              "Es obligatoria para facturar InfinityFood con Mercado Pago",
          });
      }
    }
    if (
      Boolean(value.FISCAL_PROVIDER_URL) !==
      Boolean(value.FISCAL_PROVIDER_TOKEN)
    )
      context.addIssue({
        code: "custom",
        path: ["FISCAL_PROVIDER_URL"],
        message: "Configurá URL y token del proveedor fiscal",
      });
  });

export const environment = environmentSchema.parse(process.env);

export function pilotSignupAllowed(
  email: string,
  mode = environment.PILOT_SIGNUP_MODE,
  allowedEmails = environment.PILOT_ALLOWED_EMAILS,
): boolean {
  if (mode === "open") return true;
  if (mode === "closed") return false;
  const normalized = email.trim().toLowerCase();
  return allowedEmails
    .split(",")
    .map((allowed) => allowed.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function configurationWarnings(): string[] {
  const warnings: string[] = [];
  if (
    environment.NODE_ENV === "production" &&
    environment.STORAGE_PROVIDER === "local"
  )
    warnings.push(
      "El almacenamiento local requiere un volumen persistente y backups propios",
    );
  if (environment.NODE_ENV === "production" && !environment.MP_CLIENT_ID)
    warnings.push(
      "Mercado Pago está deshabilitado porque no hay credenciales configuradas",
    );
  if (
    environment.NODE_ENV === "production" &&
    environment.SAAS_BILLING_PROVIDER === "disabled"
  )
    warnings.push(
      "La facturación automática de InfinityFood está deshabilitada",
    );
  if (environment.NODE_ENV === "production" && !environment.FISCAL_PROVIDER_URL)
    warnings.push(
      "La emisión fiscal está deshabilitada porque falta un proveedor homologado",
    );
  if (
    environment.NODE_ENV === "production" &&
    environment.EMAIL_PROVIDER === "smtp"
  )
    warnings.push(
      "SMTP puede estar bloqueado por el hosting; Resend es el proveedor recomendado",
    );
  if (environment.NODE_ENV === "production" && !environment.METRICS_TOKEN)
    warnings.push(
      "Las métricas Prometheus están deshabilitadas porque falta METRICS_TOKEN",
    );
  if (!environment.REDIS_URL)
    warnings.push(
      "Redis no está configurado; Socket.IO y locks funcionan sólo en una instancia",
    );
  if (
    environment.NODE_ENV === "production" &&
    environment.PILOT_SIGNUP_MODE === "open"
  )
    warnings.push(
      "El registro público está abierto; usá allowlist o closed durante el piloto controlado",
    );
  return warnings;
}
