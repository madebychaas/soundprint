/**
 * Comparative context, tier 4 of the results hierarchy — after Why This Works
 * and signature traits, before the raw measurements. Same data the orbit's
 * "comparative" chips carry and the interpretation layer cited; this is the
 * legible, non-truncated version for a reader who wants to see the population
 * and sample size behind a percentile rather than hover a chip.
 *
 * Takes pre-resolved `WorldContextRow[]`, not raw `FeatureContext[]` — see
 * `resolveWorldContextRows` in lib/baseline/contextualize.ts for why: this
 * component is composed inside client-rendered surfaces (SoundprintExperience),
 * and anything importing `primaryContext` at runtime pulls the SQLite baseline
 * client's `node:fs` usage into the browser bundle.
 */

import type { WorldContextRow } from "@/lib/baseline/contextualize";

export function WorldContextStrip({ highlights }: { highlights: WorldContextRow[] }) {
  if (highlights.length === 0) return null;

  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-gradient-to-r from-cobalt to-violet" />
        <span className="eyebrow">World context</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {highlights.map((h) => (
          <div key={h.feature} className="rounded-2xl border border-line/70 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-ink-2">{h.label}</span>
              <span className="tnum text-[11px] text-info">{h.percentile}th percentile</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cobalt to-fuchsia"
                style={{ width: `${Math.max(3, h.percentile)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-4">
              vs {h.populationName} · n={h.n.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
