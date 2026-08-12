/**
 * The "Why This Works" view.
 *
 * This is the payload of the product. Everything else on the page is a
 * measurement; this is the part that tells the user something they could not
 * already read off a meter.
 *
 * Each interpreted claim renders with its supporting observations attached, so
 * a reader can always answer "why does it think that?" without leaving the
 * page. Claims that cite nothing are marked as unsupported rather than quietly
 * presented alongside evidenced ones — an interpretation layer that cannot show
 * its work should not be trusted, and hiding the difference would make the
 * trustworthy claims worth less too.
 */

import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import type { Claim, DnaProvenance, SoundDna } from "@/lib/dna/schema";

export function WhyThisWorks({
  dna,
  provenance,
  issues,
  analysis,
}: {
  dna: SoundDna;
  provenance: DnaProvenance | null;
  issues: string[];
  analysis: ObjectiveAnalysis | null;
}) {
  const observationById = new Map((analysis?.observations ?? []).map((o) => [o.id, o]));
  const summary = dna.why_this_works.summary;
  const mechanisms = dna.why_this_works.mechanisms.length
    ? dna.why_this_works.mechanisms
    : dna.creative_interpretation.what_makes_it_work;

  return (
    <section className="rounded border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Why this works</h2>
        <ProvenanceBadge provenance={provenance} />
      </header>

      <div className="px-5 py-5">
        {summary ? (
          <p className="max-w-3xl text-[14.5px] leading-[1.65] text-ink">{summary}</p>
        ) : (
          <p className="text-[13px] text-ink-3">
            No synthesis was produced for this reference.
          </p>
        )}

        {mechanisms.length > 0 && (
          <div className="mt-6">
            <div className="eyebrow mb-3">The mechanisms behind it</div>
            <ul className="space-y-3.5">
              {mechanisms.map((m, i) => (
                <ClaimRow key={i} claim={m} observationById={observationById} />
              ))}
            </ul>
          </div>
        )}

        {dna.signature_traits.length > 0 && (
          <div className="mt-7">
            <div className="eyebrow mb-3">Signature traits</div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {dna.signature_traits.map((t, i) => (
                <div key={i} className="rounded border border-line bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">{t.trait}</span>
                    {t.confidence !== null && <ConfidenceChip value={t.confidence} />}
                  </div>
                  {t.why_it_matters && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{t.why_it_matters}</p>
                  )}
                  <EvidenceList ids={t.evidence} observationById={observationById} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <ClaimGroup
            title="What creates tension"
            claims={dna.creative_interpretation.what_creates_tension}
            observationById={observationById}
          />
          <ClaimGroup
            title="What creates release"
            claims={dna.creative_interpretation.what_creates_release}
            observationById={observationById}
          />
        </div>

        {dna.creative_interpretation.most_distinctive_choices.length > 0 && (
          <div className="mt-7">
            <div className="eyebrow mb-3">Most distinctive choices</div>
            <ul className="space-y-3">
              {dna.creative_interpretation.most_distinctive_choices.map((c, i) => (
                <ClaimRow key={i} claim={c} observationById={observationById} />
              ))}
            </ul>
          </div>
        )}

        {(dna.uncertainty.unmeasurable.length > 0 ||
          dna.uncertainty.low_confidence_areas.length > 0) && (
          <div className="mt-7 rounded border border-line bg-surface-2 p-4">
            <div className="eyebrow mb-2.5">What this analysis cannot tell you</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {dna.uncertainty.unmeasurable.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11.5px] font-medium text-ink-2">Not measurable</div>
                  <ul className="space-y-1">
                    {dna.uncertainty.unmeasurable.map((u, i) => (
                      <li key={i} className="text-[12px] leading-relaxed text-ink-3">
                        · {u}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dna.uncertainty.low_confidence_areas.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11.5px] font-medium text-warn">Low confidence</div>
                  <ul className="space-y-1">
                    {dna.uncertainty.low_confidence_areas.map((u, i) => (
                      <li key={i} className="text-[12px] leading-relaxed text-ink-3">
                        · {u}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {dna.creative_interpretation.what_not_to_copy.length > 0 && (
          <div className="mt-5 rounded border border-line/70 px-4 py-3">
            <div className="eyebrow mb-2">Keep original — do not reproduce</div>
            <ul className="flex flex-wrap gap-1.5">
              {dna.creative_interpretation.what_not_to_copy.map((v, i) => (
                <li
                  key={i}
                  className="rounded border border-line bg-surface-2 px-2 py-1 text-[11.5px] text-ink-3"
                >
                  {v}
                </li>
              ))}
            </ul>
          </div>
        )}

        {issues.length > 0 && (
          <details className="mt-5">
            <summary className="cursor-pointer text-[11.5px] text-ink-4 hover:text-ink-3">
              {issues.length} note{issues.length === 1 ? "" : "s"} about how this profile was generated
            </summary>
            <ul className="mt-2 space-y-1">
              {issues.map((it, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-ink-4">
                  · {it}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function ClaimGroup({
  title,
  claims,
  observationById,
}: {
  title: string;
  claims: Claim[];
  observationById: Map<string, { text: string }>;
}) {
  if (claims.length === 0) return null;
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      <ul className="space-y-3">
        {claims.map((c, i) => (
          <ClaimRow key={i} claim={c} observationById={observationById} />
        ))}
      </ul>
    </div>
  );
}

function ClaimRow({
  claim,
  observationById,
}: {
  claim: Claim;
  observationById: Map<string, { text: string }>;
}) {
  return (
    <li className="border-l-2 border-line pl-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13.5px] leading-relaxed text-ink">{claim.claim}</p>
        {claim.confidence !== null && <ConfidenceChip value={claim.confidence} />}
      </div>
      <EvidenceList ids={claim.evidence} observationById={observationById} />
    </li>
  );
}

/**
 * Show the measurements a claim rests on.
 *
 * Citing an id that does not exist in the analysis is treated as no citation —
 * a hallucinated reference is worse than an absent one because it looks like
 * evidence.
 */
function EvidenceList({
  ids,
  observationById,
}: {
  ids: string[];
  observationById: Map<string, { text: string }>;
}) {
  const resolved = ids.map((id) => observationById.get(id)).filter((o): o is { text: string } => !!o);

  if (resolved.length === 0) {
    return (
      <div className="mt-1.5 text-[11px] italic text-ink-4">
        Interpretation only — no specific measurement cited.
      </div>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1">
      {resolved.map((o, i) => (
        <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-ink-3">
          <span className="shrink-0 text-ink-4">observed</span>
          <span>{o.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ConfidenceChip({ value }: { value: number }) {
  const tone = value >= 0.7 ? "text-good" : value >= 0.45 ? "text-ink-3" : "text-warn";
  return (
    <span className={`tnum shrink-0 text-[10.5px] ${tone}`} title="Model confidence">
      {value.toFixed(2)}
    </span>
  );
}

function ProvenanceBadge({ provenance }: { provenance: DnaProvenance | null }) {
  if (!provenance) return null;
  if (provenance.heuristic) {
    return (
      <span className="rounded border border-warn/40 bg-warn/5 px-2 py-1 text-[10.5px] text-warn">
        Built-in rules — no language model
      </span>
    );
  }
  return (
    <span className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-3">
      {provenance.provider}
      {provenance.model ? ` · ${provenance.model}` : ""}
    </span>
  );
}
