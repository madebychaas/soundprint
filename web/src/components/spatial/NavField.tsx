"use client";

/**
 * Floating navigation.
 *
 * Not a top bar: two translucent pills anchored to the corner, no full-width
 * band, no border spanning the viewport. "Compare" and "Create" are
 * project/reference-scoped, so they stay where they already lived — rendered
 * contextually inside the project and reference pages as lightweight actions
 * — rather than living here as dead links when no project is open.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SystemStatus } from "@/components/SystemStatus";

function NavPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
        active
          ? "border-fuchsia/50 bg-signal-wash text-ink"
          : "border-line bg-surface/70 text-ink-2 hover:border-line-bright hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

export function NavField() {
  const pathname = usePathname();

  return (
    <div className="pointer-events-none sticky top-0 z-40 flex items-start justify-between gap-3 px-4 pt-4 sm:px-6">
      <Link href="/" className="pointer-events-auto flex items-center gap-2">
        <span
          aria-hidden="true"
          className="sp-breathe flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{
            background: "radial-gradient(circle at 35% 30%, #ffe6f5, var(--color-fuchsia) 45%, var(--color-violet) 85%)",
          }}
        >
          S
        </span>
        <span className="hidden text-[13px] font-semibold tracking-tight text-ink sm:inline">
          Soundprint
        </span>
      </Link>

      <div className="pointer-events-auto flex items-center gap-2">
        <NavPill href="/" active={pathname === "/"}>
          Sounds
        </NavPill>
        <NavPill href="/taste" active={pathname === "/taste"}>
          Taste
        </NavPill>
        <SystemStatus />
      </div>
    </div>
  );
}
