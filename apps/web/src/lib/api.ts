import { beginOperation } from "./pending-operation";

// Requests go through the web domain so authentication cookies remain first-party.
const apiUrl = "/api";

export function apiAbsoluteUrl(path: string): string {
  return `${apiUrl}${path}`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
  }
}

const apiFieldLabels: Record<string, string> = {
  announcement: "el anuncio superior",
  banner: "la portada",
  bannerUrl: "la portada",
  contactEmail: "el email de contacto",
  description: "la descripción",
  email: "el email",
  images: "las imágenes",
  logo: "el logo",
  logoUrl: "el logo",
  name: "el nombre",
  password: "la contraseña",
  primaryColor: "el color principal",
  secondaryColor: "el color secundario",
  storeName: "el nombre de la tienda",
  storeSlug: "la dirección de la tienda",
  whatsapp: "el WhatsApp",
};

function friendlyField(field: string): string {
  const key = field.split(".").findLast((part) => Number.isNaN(Number(part))) ?? field;
  return apiFieldLabels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function responseErrorMessage(
  status: number,
  body: { error?: string; message?: string; details?: Array<{ field: string; message: string }> } | null,
): string {
  const firstDetail = body?.details?.[0];
  if (body?.error === "VALIDATION_ERROR" && firstDetail) {
    const generic = !body.message || body.message === "Los datos enviados no son válidos";
    if (generic) return `Revisá ${friendlyField(firstDetail.field)}: ${firstDetail.message}`;
  }
  if (body?.message) return body.message;
  if (status === 401) return "Tu sesión venció. Ingresá nuevamente para continuar.";
  if (status === 403) return "No tenés permisos para realizar esta acción.";
  if (status === 404) return "No encontramos el recurso solicitado.";
  if (status === 409) return "La información cambió o ya existe. Actualizá la página y volvé a intentarlo.";
  if (status === 413) return "El archivo es demasiado grande para subirlo.";
  if (status === 429) return "Realizaste demasiados intentos. Esperá un momento y probá nuevamente.";
  if (status >= 500) return "El servicio está temporalmente ocupado. Tus datos no se perdieron; volvé a intentarlo.";
  return "No pudimos completar la operación. Revisá los datos e intentá nuevamente.";
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const mutation = !["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase());
  const release = mutation && typeof window !== "undefined" ? beginOperation() : () => {};
  const timeout = AbortSignal.timeout(mutation ? 120_000 : 20_000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      credentials: "include",
      headers: {
        ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        details?: Array<{ field: string; message: string }>;
      } | null;
      throw new ApiError(
        response.status,
        responseErrorMessage(response.status, body),
        body?.error,
        body?.details ?? [],
      );
    }

    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timeout.aborted) throw new ApiError(408, mutation
      ? "No pudimos confirmar el resultado a tiempo. Revisá el estado antes de volver a enviar."
      : "La consulta está tardando demasiado. Volvé a intentar en unos instantes.");
    if (init.signal?.aborted) throw new ApiError(499, "La operación fue cancelada.");
    if (error instanceof TypeError) throw new ApiError(0, "No pudimos conectarnos con InfinityFood. Revisá tu conexión y volvé a intentarlo.");
    throw new ApiError(500, "Recibimos una respuesta inesperada. Volvé a intentarlo y, si continúa, contactá a soporte.");
  } finally {
    release();
  }
}
