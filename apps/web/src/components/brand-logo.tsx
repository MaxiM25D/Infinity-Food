import Image from "next/image";
import Link from "next/link";

export function BrandLogo({
  compact = false,
  tone = "dark",
  subtitle = "by InfinityDev",
  size = "md",
  priority = false,
}: {
  compact?: boolean;
  tone?: "dark" | "light";
  subtitle?: string;
  size?: "sm" | "md";
  priority?: boolean;
}) {
  return (
    <Link
      aria-label={compact ? "InfinityFood - ir al inicio" : undefined}
      className="inline-flex items-center gap-3"
      href="/"
    >
      <span className={`relative shrink-0 overflow-hidden border border-white/10 bg-[#05082d] shadow-[0_0_30px_rgba(163,52,210,.25)] ${size === "sm" ? "h-8 w-8 rounded-lg" : "h-11 w-11 rounded-xl"}`}>
        <Image
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
          height={256}
          priority={priority}
          sizes={size === "sm" ? "32px" : "44px"}
          src="/infinityfood-mark.png"
          width={256}
        />
      </span>
      {!compact && (
        <span>
          <strong
            className={`block text-base leading-tight tracking-tight ${
              tone === "dark" ? "text-white" : "text-[#241a28]"
            }`}
          >
            InfinityFood
          </strong>
          <span
            className={`block text-[9px] font-semibold uppercase tracking-[0.28em] ${
              tone === "dark" ? "text-white/40" : "text-[#806f85]"
            }`}
          >
            {subtitle}
          </span>
        </span>
      )}
    </Link>
  );
}
