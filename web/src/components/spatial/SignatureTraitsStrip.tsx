/**
 * Signature traits, tier 3 of the results hierarchy. Legible, un-truncated
 * counterpart to the "interpreted" chips in the orbit above — those exist to
 * be *seen* clustering around the object; this exists to be *read*.
 */

import type { SignatureTrait } from "@/lib/dna/schema";

export function SignatureTraitsStrip({ traits }: { traits: SignatureTrait[] }) {
  if (traits.length === 0) return null;

  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-gradient-to-r from-fuchsia to-violet" />
        <span className="eyebrow">Sound DNA traits</span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {traits.map((t, i) => (
          <div key={i} className="rounded-2xl border border-fuchsia/25 bg-signal-wash/40 px-3.5 py-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] font-medium leading-snug text-ink">{t.trait}</span>
              {t.confidence !== null && (
                <span className="tnum shrink-0 text-[10px] text-ink-3">{t.confidence.toFixed(2)}</span>
              )}
            </div>
            {t.why_it_matters && (
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{t.why_it_matters}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
