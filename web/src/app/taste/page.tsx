import Link from "next/link";

import { recomputeTasteProfile } from "@/lib/taste/engine";

export const dynamic = "force-dynamic";

export default async function TastePage() {
  // Recompute on view: it is a cheap pure function over stored data, and a
  // stale profile is worse than a recomputed one.
  const profile = await recomputeTasteProfile();

  const MATURITY: Record<string, { label: string; cls: string }> = {
    insufficient: { label: "Not enough evidence", cls: "text-ink-4 border-line" },
    emerging: { label: "Emerging", cls: "text-warn border-warn/40" },
    established: { label: "Established", cls: "text-good border-good/40" },
  };
  const m = MATURITY[profile.maturity];

  return (
    <div className="max-w-4xl">
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
          <span className={`rounded border px-2 py-1 text-[10.5px] ${m.cls}`}>{m.label}</span>
        </div>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{profile.note}</p>
        <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-ink-4">
          This profile records recurring <em>tendencies</em>, not averages. The mean BPM of your
          favourite tracks would tell you nothing; that you consistently choose arrangements which
          withhold their payoff tells you something you can use.
        </p>
      </header>

      {profile.traits.length === 0 ? (
        <div className="rounded border border-dashed border-line px-6 py-16 text-center">
          <p className="text-[13px] text-ink-2">No tendencies inferred yet.</p>
          <p className="mt-1.5 text-[12px] text-ink-4">
            Rate references Love or Like and they will start appearing here.
          </p>
          <Link href="/" className="mt-4 inline-block text-[12.5px] text-signal hover:underline">
            Go to projects
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {profile.traits.map((t) => (
            <li key={t.id} className="rounded border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium leading-snug">{t.trait}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-4">{t.explain}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[15px] font-semibold text-signal">
                    {t.confidence.toFixed(2)}
                  </div>
                  <div className="text-[10.5px] text-ink-4">
                    {t.evidence_count} reference{t.evidence_count === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div className="mt-3 h-1 overflow-hidden rounded-sm bg-surface-3">
                <div
                  className="h-full bg-signal"
                  style={{ width: `${Math.round(t.confidence * 100)}%` }}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {t.supporting_references.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-ink-4">supports: </span>
                    {t.supporting_references.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && <span className="text-ink-4">, </span>}
                        <Link href={`/references/${r.id}`} className="text-ink-2 hover:text-signal">
                          {r.title}
                        </Link>
                      </span>
                    ))}
                  </div>
                )}
                {t.contradicting_references.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-ink-4">contradicts: </span>
                    {t.contradicting_references.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && <span className="text-ink-4">, </span>}
                        <Link href={`/references/${r.id}`} className="text-warn/80 hover:text-warn">
                          {r.title}
                        </Link>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {profile.traits.length > 0 && (
        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-4">
          Confidence is shrunk toward zero when evidence is thin, so a single loved track will
          never produce a strong claim. Traits below the noise floor are hidden rather than shown
          with false precision. Rated {profile.ratedCount} reference
          {profile.ratedCount === 1 ? "" : "s"}, {profile.positiveCount} positively.
        </p>
      )}
    </div>
  );
}
