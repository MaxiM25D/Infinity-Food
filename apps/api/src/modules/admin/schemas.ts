import { z } from "zod";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Usá letras minúsculas, números y guiones simples",
  );
const resourceId = z.string().trim().min(1).max(64);
const storeAssetUrl = z
  .string()
  .trim()
  .max(2048, "La dirección de la imagen es demasiado larga")
  .refine((value) => {
    if (/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "La imagen debe usar una dirección web válida");
const optionalStoreAssetUrl = storeAssetUrl.nullable().optional();
const socialUrl = (hosts: string[], network: string) => z
  .url()
  .trim()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  }, `Ingresá un enlace HTTPS válido de ${network}`)
  .nullable()
  .optional();

export const resourceIdSchema = resourceId;

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const productListQuerySchema = z.object({
  search: z.string().trim().max(100).default(""),
  category: z.string().trim().max(64).default("ALL"),
  visibility: z.enum(["ALL", "ACTIVE", "HIDDEN"]).default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const productImportModeSchema = z.enum(["CREATE_ONLY", "UPSERT"]).default("CREATE_ONLY");

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug,
    description: z.string().trim().max(500).nullable().optional(),
    displayOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "Enviá al menos un campo");

export const createProductSchema = z
  .object({
    categoryId: resourceId.nullable().optional(),
    sku: z.string().trim().toUpperCase().min(2).max(64),
    slug,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(4000).nullable().optional(),
    priceInCents: z.number().int().min(0).max(2_000_000_000),
    stock: z.number().int().min(0).max(2_000_000_000),
    images: z.array(z.url().max(2048)).max(8).default([]),
    active: z.boolean().default(true),
    brand: z.string().trim().max(100).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    featured: z.boolean().default(false),
    featuredOrder: z.number().int().min(0).max(10_000).default(0),
    preparationTimeMinutes: z.number().int().min(0).max(1440).default(15),
    allergens: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    dietaryTags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  })
  .strict();

export const updateProductSchema = createProductSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "Enviá al menos un campo");

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    logoUrl: optionalStoreAssetUrl,
    bannerUrl: optionalStoreAssetUrl,
    primaryColor: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, "Usá un color hexadecimal de seis dígitos")
      .optional(),
    secondaryColor: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, "Usá un color hexadecimal de seis dígitos")
      .optional(),
    fontFamily: z.enum(["SYSTEM", "SERIF", "MODERN"]).optional(),
    borderRadius: z.enum(["SQUARE", "MEDIUM", "SOFT"]).optional(),
    announcement: z.string().trim().max(180).nullable().optional(),
    contactEmail: z.email().trim().toLowerCase().max(254).nullable().optional(),
    whatsapp: z.string().trim().regex(/^\+?[0-9 ()-]{8,30}$/, "Ingresá un WhatsApp válido con código de país").nullable().optional(),
    instagramUrl: socialUrl(["instagram.com"], "Instagram"),
    facebookUrl: socialUrl(["facebook.com", "fb.com"], "Facebook"),
    tiktokUrl: socialUrl(["tiktok.com"], "TikTok"),
    xUrl: socialUrl(["x.com", "twitter.com"], "X"),
    youtubeUrl: socialUrl(["youtube.com", "youtu.be"], "YouTube"),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    bankName: z.string().trim().max(100).nullable().optional(),
    bankAlias: z.string().trim().max(100).nullable().optional(),
    bankHolder: z.string().trim().max(120).nullable().optional(),
    bankCvu: z.string().trim().max(40).nullable().optional(),
    bankCuit: z.string().trim().max(20).nullable().optional(),
    bankTransferEnabled: z.boolean().optional(),
    bankReservationHours: z.number().int().min(1).max(168).optional(),
    emailFromName: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, "Enviá al menos un campo");

export const updateOrderSchema = z
  .object({
    status: z
      .enum([
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "SHIPPED",
        "DELIVERED",
        "READY_FOR_PICKUP",
        "PICKED_UP",
        "CANCELLED",
      ])
      .optional(),
    paymentStatus: z
      .enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUNDED"])
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, "Enviá al menos un estado");

export const updateOrderContactSchema = z
  .object({ email: z.email().trim().toLowerCase().max(254) })
  .strict();

export const addMemberSchema = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    role: z.enum(["ADMIN", "STAFF"]),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    role: z.enum(["ADMIN", "STAFF"]),
  })
  .strict();

export const dispatchOrderSchema = z
  .object({
    carrier: z.string().trim().min(2).max(80),
    trackingCode: z.string().trim().max(100).nullable().optional(),
    trackingUrl: z.url().trim().max(2048).nullable().optional(),
    estimatedDelivery: z.coerce
      .date()
      .min(new Date(), "La entrega estimada no puede estar en el pasado")
      .nullable()
      .optional(),
  })
  .strict();
