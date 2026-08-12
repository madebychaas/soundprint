import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import { SystemStatus } from "@/components/SystemStatus";

export const metadata: Metadata = {
  title: "Soundprint",
  description:
    "Translate what is musically distinctive about a reference track into a reusable Sound DNA profile.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-void text-ink">
        <header className="sticky top-0 z-40 border-b border-line bg-void/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-6">
            <Link href="/" className="flex items-baseline gap-2.5 shrink-0">
              <span className="text-[15px] font-semibold tracking-tight">Soundprint</span>
              <span className="hidden text-[11px] text-ink-4 sm:inline">
                reference → sound DNA
              </span>
            </Link>

            <nav className="flex items-center gap-1 text-[13px]">
              <NavLink href="/">Projects</NavLink>
              <NavLink href="/taste">Taste Profile</NavLink>
            </nav>

            <div className="ml-auto">
              <SystemStatus />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>

        <footer className="mx-auto max-w-[1400px] px-6 pb-10 pt-4">
          <p className="text-[11px] leading-relaxed text-ink-4">
            Audio files never leave this machine. When an AI provider is configured, only
            derived analysis — numbers and measurement summaries — is sent for interpretation.
            Soundprint describes musical characteristics so you can create something new; it
            does not reproduce recordings, melodies or lyrics.
          </p>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded px-2.5 py-1.5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
