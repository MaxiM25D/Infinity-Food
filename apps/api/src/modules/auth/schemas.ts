import { z } from "zod";

const email = z.email("Ingresá un email válido").trim().toLowerCase().max(254, "El email es demasiado largo");
export const newPasswordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede superar los 72 caracteres")
  .regex(/[a-z]/, "La contraseña debe incluir una letra minúscula")
  .regex(/[A-Z]/, "La contraseña debe incluir una letra mayúscula")
  .regex(/\d/, "La contraseña debe incluir un número")
  .regex(/[^A-Za-z0-9]/, "La contraseña debe incluir un símbolo");
const loginPassword = z.string().min(1).max(72);
export const tenantSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Usá letras minúsculas, números y guiones simples",
  );

export const registerSchema = z
  .object({
    email,
    password: newPasswordSchema,
    firstName: z.string().trim().min(2, "Ingresá al menos 2 caracteres").max(60, "El nombre no puede superar los 60 caracteres"),
    lastName: z.string().trim().min(2, "Ingresá al menos 2 caracteres").max(60, "El apellido no puede superar los 60 caracteres"),
    storeName: z.string().trim().min(2, "Ingresá al menos 2 caracteres").max(100, "El nombre de la tienda no puede superar los 100 caracteres"),
    storeSlug: tenantSlug,
    planCode: z.literal("PRO").default("PRO"),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: loginPassword,
    tenantSlug: tenantSlug.optional(),
  })
  .strict();

export const selectTenantSchema = z.object({ tenantSlug }).strict();
export const selectBranchSchema = z.object({ branchId: z.string().trim().min(1).max(100) }).strict();

export const createTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: tenantSlug,
    planCode: z.literal("PRO").default("PRO"),
  })
  .strict();

const accountToken = z.string().trim().min(32).max(256);

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({ token: accountToken, password: newPasswordSchema })
  .strict();

export const verifyEmailSchema = z.object({ token: accountToken }).strict();

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: loginPassword,
  newPassword: newPasswordSchema,
}).strict().refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
  message: "La nueva contraseña debe ser diferente a la actual",
  path: ["newPassword"],
});

export const invitationTokenSchema = z.object({ token: accountToken }).strict();

export const acceptInvitationSchema = z
  .object({
    token: accountToken,
    password: loginPassword,
    firstName: z.string().trim().min(2).max(60).optional(),
    lastName: z.string().trim().min(2).max(60).optional(),
  })
  .strict();
