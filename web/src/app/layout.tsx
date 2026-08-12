import type { Metadata } from "next";

import "./globals.css";
import { NavField } from "@/components/spatial/NavField";

export const metadata: Metadata = {
  title: "Soundprint",
  description:
    "Translate what is musically distinctive about a reference track into a reusable Sound DNA profile.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-void text-ink">
        {/* A spatial field, not a page shell: no full-width bar, no sidebar.
            The wordmark and destinations float over the field instead. */}
        <NavField />

        <main className="mx-auto max-w-[1400px] px-4 pb-8 pt-2 sm:px-6">{children}</main>

        <footer className="mx-auto max-w-[1400px] px-4 pb-10 pt-4 sm:px-6">
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
