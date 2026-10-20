"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { ApiError, apiRequest } from "@/lib/api";
import { type MarketingPlan, type MarketingPlanCode } from "@/lib/plan-catalog";

type Mode = "login" | "register";

export function AccessForm({
  initialMode = "login",
  initialPlan = "PRO",
  plans,
}: {
  initialMode?: Mode;
  initialPlan?: MarketingPlanCode;
  plans: MarketingPlan[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [customSlug, setCustomSlug] = useState(false);
  const planCode: MarketingPlanCode = initialPlan;
  const selectedPlan = plans.find((plan) => plan.code === planCode) ?? plans[0];

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setFieldErrors({});
    setShowPassword(false);
    setPassword("");
    setPasswordConfirmation("");
  }

  function clearFieldError(name: string) {
    setError((current) => current === "Revisá los campos marcados para continuar." ? "" : current);
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (mode === "register") {
      const validationErrors = validateRegistration(form);
      setFieldErrors(validationErrors);
      if (Object.keys(validationErrors).length > 0) {
        setError("Revisá los campos marcados para continuar.");
        requestAnimationFrame(() => {
          formElement
            .querySelector<HTMLElement>("[aria-invalid='true']")
            ?.focus();
        });
        return;
      }
    }

    setBusy(true);
    const body =
      mode === "login"
        ? { email: form.get("email"), password: form.get("password") }
        : {
            email: form.get("email"),
            password: form.get("password"),
            firstName: form.get("firstName"),
            lastName: form.get("lastName"),
            storeName: form.get("storeName"),
            storeSlug: form.get("storeSlug"),
            planCode,
          };

    try {
      const result = await apiRequest<{
        verification?: { verificationUrl?: string };
      }>(mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (mode === "register") {
        const verificationUrl = result.verification?.verificationUrl;
        router.push(
          verificationUrl
            ? `${new URL(verificationUrl).pathname}${new URL(verificationUrl).search}`
            : "/verificar-email?sent=1",
        );
      } else {
        router.push("/admin");
      }
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        setFieldErrors(Object.fromEntries(caught.details.map(({ field, message }) => [field, friendlyValidationMessage(field, message)])));
        setError("Revisá los campos marcados para continuar.");
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo conectar con la API",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-[2rem] border border-white/10 bg-[#0b0d28]/85 p-6 shadow-[0_35px_100px_rgba(0,0,0,.45)] backdrop-blur-xl sm:p-8"
      initial={{ opacity: 0, y: 22 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-8 grid grid-cols-2 rounded-xl border border-white/[.07] bg-white/[.04] p-1">
        {(["login", "register"] as const).map((item) => (
          <button
            className={`relative rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode === item ? "text-white" : "text-white/40 hover:text-white/70"}`}
            key={item}
            onClick={() => changeMode(item)}
            type="button"
          >
            {mode === item && (
              <motion.span
                className="absolute inset-0 rounded-lg border border-white/10 bg-white/10 shadow-sm"
                layoutId="access-mode"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">
              {item === "login" ? "Ingresar" : "Crear tienda"}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === "login" ? 12 : -12 }}
          initial={{ opacity: 0, x: mode === "login" ? -12 : 12 }}
          key={mode}
          transition={{ duration: 0.2 }}
        >
          <div className="mb-7">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-300">
              {mode === "login" ? "Bienvenido de nuevo" : selectedPlan.trialDays > 0 ? `${selectedPlan.trialDays} días gratis` : "Creá tu tienda"}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {mode === "login"
                ? "Volvé a tu negocio"
                : "Creá tu tienda online"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/45">
              {mode === "login"
                ? "Todo lo que necesitás para seguir vendiendo."
                : "Configurá lo esencial ahora. Podés personalizar todo después."}
            </p>
          </div>

          <form className="space-y-4" noValidate={mode === "register"} onSubmit={submit}>
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  autoComplete="given-name"
                  icon={UserRound}
                  label="Nombre"
                  name="firstName"
                  error={fieldErrors.firstName}
                  maxLength={60}
                  minLength={2}
                  onChange={() => clearFieldError("firstName")}
                  placeholder=""
                />
                <Field
                  autoComplete="family-name"
                  icon={UserRound}
                  label="Apellido"
                  name="lastName"
                  error={fieldErrors.lastName}
                  maxLength={60}
                  minLength={2}
                  onChange={() => clearFieldError("lastName")}
                  placeholder=""
                />
              </div>
            )}
            <Field
              autoComplete="email"
              icon={Mail}
              label="Email"
              name="email"
              error={fieldErrors.email}
              maxLength={254}
              onChange={() => clearFieldError("email")}
              placeholder="vos@tienda.com"
              type="email"
            />
            <Field
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              icon={LockKeyhole}
              label="Contraseña"
              name="password"
              error={fieldErrors.password}
              maxLength={72}
              minLength={mode === "register" ? 8 : undefined}
              onChange={(value) => {
                setPassword(value);
                clearFieldError("password");
                if (passwordConfirmation) clearFieldError("passwordConfirmation");
              }}
              placeholder={mode === "register" ? "Creá una contraseña segura" : "Tu contraseña"}
              type={showPassword ? "text" : "password"}
              value={password}
              trailing={
                <button
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  className="text-white/35 transition hover:text-white"
                  onClick={() => setShowPassword((visible) => !visible)}
                  type="button"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
            />
            {mode === "register" && (
              <>
                <PasswordGuidance password={password} />
                <Field
                  autoComplete="new-password"
                  icon={LockKeyhole}
                  label="Repetir contraseña"
                  name="passwordConfirmation"
                  error={fieldErrors.passwordConfirmation}
                  maxLength={72}
                  minLength={8}
                  onChange={(value) => {
                    setPasswordConfirmation(value);
                    clearFieldError("passwordConfirmation");
                  }}
                  placeholder="Escribila nuevamente"
                  type={showPassword ? "text" : "password"}
                  value={passwordConfirmation}
                />
                {passwordConfirmation && !fieldErrors.passwordConfirmation && (
                  <p className={`-mt-2 flex items-center gap-2 text-xs ${password === passwordConfirmation ? "text-emerald-300" : "text-amber-300"}`}>
                    <span aria-hidden="true">{password === passwordConfirmation ? "✓" : "•"}</span>
                    {password === passwordConfirmation ? "Las contraseñas coinciden" : "Todavía no coinciden"}
                  </p>
                )}
              </>
            )}
            {mode === "login" && (
              <Link
                className="block text-right text-xs font-semibold text-blue-300 transition hover:text-blue-200"
                href="/recuperar-clave"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            )}

            {mode === "register" && (
              <>
                <Field
                  autoComplete="organization"
                  icon={Store}
                  label="Nombre de la tienda"
                  name="storeName"
                  error={fieldErrors.storeName}
                  maxLength={100}
                  minLength={2}
                  onChange={(value) => {
                    clearFieldError("storeName");
                    setStoreName(value);
                    if (!customSlug) {
                      setStoreSlug(createSlug(value));
                      clearFieldError("storeSlug");
                    }
                  }}
                  placeholder="Mi tienda"
                  value={storeName}
                />
                <Field
                  icon={Store}
                  label="Dirección de tu tienda"
                  name="storeSlug"
                  error={fieldErrors.storeSlug}
                  maxLength={48}
                  minLength={3}
                  onChange={(value) => {
                    clearFieldError("storeSlug");
                    setCustomSlug(true);
                    setStoreSlug(createSlug(value));
                  }}
                  placeholder="mi-tienda"
                  prefix="infinityfood.com.ar/tienda/"
                  value={storeSlug}
                />
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-white/70">InfinityFood Pro</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">
                      {selectedPlan.trialDays > 0 ? `${selectedPlan.trialDays} días gratis` : "Sin prueba"}
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {plans.map((plan) => {
                      return (
                        <div
                          className="relative rounded-xl border border-fuchsia-400/70 bg-fuchsia-400/10 p-3 ring-2 ring-fuchsia-400/10"
                          key={plan.code}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <strong className="text-sm text-white">
                              {plan.name}
                            </strong>
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-fuchsia-400 text-[#080a2d]">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </span>
                          </span>
                          <span className="mt-2 block text-base font-bold text-white">
                            {plan.price}
                            <span className="ml-1 text-[10px] font-normal text-white/35">
                              /mes
                            </span>
                          </span>
                          <span className="mt-1 block text-[10px] leading-4 text-white/35">
                            {plan.capacity}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    No se realizará ningún cobro durante el período de prueba.
                  </p>
                </div>
                <p className="text-xs leading-5 text-white/35">
                  Al continuar aceptás los términos de uso y la política de
                  privacidad.
                </p>
              </>
            )}

            {error && (
              <motion.p
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-2 rounded-xl border border-red-400/15 bg-red-400/10 px-4 py-3 text-sm text-red-200"
                initial={{ opacity: 0, y: -4 }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </motion.p>
            )}

            <button
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#a334d2] to-[#397eea] px-5 py-3.5 text-sm font-bold text-white shadow-[0_14px_35px_rgba(121,54,210,.25)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(121,54,210,.4)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Procesando…
                </>
              ) : (
                <>
                  {mode === "login" ? "Ingresar al panel" : "Crear mi tienda"}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

const passwordRules = [
  { label: "8 caracteres como mínimo", test: (value: string) => value.length >= 8 },
  { label: "Una letra mayúscula", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Una letra minúscula", test: (value: string) => /[a-z]/.test(value) },
  { label: "Un número", test: (value: string) => /\d/.test(value) },
  { label: "Un símbolo, por ejemplo ! @ #", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

function PasswordGuidance({ password }: { password: string }) {
  const results = passwordRules.map((rule) => ({ ...rule, met: rule.test(password) }));
  const completed = results.filter(({ met }) => met).length;
  const ready = completed === results.length && password.length <= 72;

  return (
    <div className="-mt-1 rounded-xl border border-white/[.08] bg-white/[.035] p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-white/75">Seguridad de la contraseña</p>
          <p className={`mt-1 text-[11px] ${ready ? "text-emerald-300" : password ? "text-amber-300" : "text-white/35"}`}>
            {ready ? "Lista para usar" : password ? `Cumplís ${completed} de ${results.length} requisitos` : "Completá todos los requisitos"}
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-white/35">{password.length}/72</span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden="true">
        {results.map(({ label, met }) => <span className={`h-1.5 rounded-full transition-colors ${met ? "bg-emerald-400" : "bg-white/10"}`} key={label} />)}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {results.map(({ label, met }) => (
          <p className={`flex items-start gap-2 text-[11px] leading-4 transition-colors ${met ? "text-emerald-300" : "text-white/40"}`} key={label}>
            <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-[9px] ${met ? "border-emerald-400 bg-emerald-400 text-[#071b17]" : "border-white/20"}`}>{met ? "✓" : ""}</span>
            {label}
          </p>
        ))}
      </div>
    </div>
  );
}

function validateRegistration(form: FormData) {
  const value = (name: string) => String(form.get(name) ?? "");
  const errors: Record<string, string> = {};
  const firstName = value("firstName").trim();
  const lastName = value("lastName").trim();
  const email = value("email").trim();
  const password = value("password");
  const confirmation = value("passwordConfirmation");
  const storeName = value("storeName").trim();
  const storeSlug = value("storeSlug").trim();

  if (firstName.length < 2) errors.firstName = "Ingresá al menos 2 caracteres.";
  else if (firstName.length > 60) errors.firstName = "El nombre no puede superar los 60 caracteres.";
  if (lastName.length < 2) errors.lastName = "Ingresá al menos 2 caracteres.";
  else if (lastName.length > 60) errors.lastName = "El apellido no puede superar los 60 caracteres.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Ingresá un email válido, sin espacios.";
  if (password.length > 72) errors.password = "La contraseña no puede superar los 72 caracteres.";
  else if (!passwordRules.every((rule) => rule.test(password))) errors.password = "La contraseña todavía no cumple todos los requisitos.";
  if (!confirmation) errors.passwordConfirmation = "Repetí la contraseña para evitar errores.";
  else if (password !== confirmation) errors.passwordConfirmation = "Las contraseñas no coinciden.";
  if (storeName.length < 2) errors.storeName = "Ingresá al menos 2 caracteres.";
  else if (storeName.length > 100) errors.storeName = "El nombre de la tienda no puede superar los 100 caracteres.";
  if (storeSlug.length < 3 || storeSlug.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeSlug))
    errors.storeSlug = "Usá entre 3 y 48 letras minúsculas, números o guiones simples.";

  return errors;
}

function friendlyValidationMessage(field: string, message: string) {
  const messages: Record<string, string> = {
    email: "Ingresá un email válido, sin espacios.",
    password: "La contraseña debe tener 8 caracteres o más e incluir mayúscula, minúscula, número y símbolo.",
    firstName: "Revisá el nombre ingresado.",
    lastName: "Revisá el apellido ingresado.",
    storeName: "Revisá el nombre de la tienda.",
    storeSlug: "La dirección debe tener entre 3 y 48 letras minúsculas, números o guiones simples.",
  };
  return messages[field] ?? message;
}

function Field({
  autoComplete,
  error,
  icon: Icon,
  label,
  maxLength,
  minLength,
  name,
  onChange,
  placeholder,
  prefix,
  trailing,
  type = "text",
  value,
}: {
  autoComplete?: string;
  error?: string;
  icon: LucideIcon;
  label: string;
  maxLength?: number;
  minLength?: number;
  name: string;
  onChange?: (value: string) => void;
  placeholder: string;
  prefix?: string;
  trailing?: React.ReactNode;
  type?: string;
  value?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <label className="block text-sm font-medium text-white/70">
      <span className="mb-1.5 block">{label}</span>
      <span className={`flex min-h-12 items-center rounded-xl border bg-white/[.045] px-3.5 transition focus-within:bg-white/[.07] focus-within:ring-2 ${error ? "border-red-400/70 ring-2 ring-red-400/10 focus-within:border-red-300 focus-within:ring-red-400/15" : "border-white/10 focus-within:border-fuchsia-400/60 focus-within:ring-fuchsia-400/10"}`}>
        <Icon className={`mr-3 h-4 w-4 shrink-0 ${error ? "text-red-300" : "text-white/25"}`} />
        {prefix && (
          <span className="hidden shrink-0 text-xs text-white/25 sm:inline">
            {prefix}
          </span>
        )}
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          autoComplete={autoComplete}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/20"
          maxLength={maxLength}
          minLength={minLength}
          name={name}
          onChange={
            onChange ? (event) => onChange(event.target.value) : undefined
          }
          placeholder={placeholder}
          required
          type={type}
          value={value}
        />
        {trailing}
      </span>
      {error && <span className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-red-300" id={errorId} role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</span>}
    </label>
  );
}

function createSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
