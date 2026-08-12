/**
 * "Why This Works" as editorial copy in the field, not a card.
 *
 * Same data, same evidence-citation rule as the original WhyThisWorks: a
 * claim that cites nothing is labelled as such rather than presented next to
 * evidenced ones at equal weight. Only the presentation changes — no card
 * border around the summary, no eyebrow/heading/description repetition, the
 * accent is a thin gradient rule instead of a boxed rectangle.
 */

import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import type { Claim, DnaProvenance, SoundDna } from "@/lib/dna/schema";

export function WhyThisWorksField({
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
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-gradient-to-r from-fuchsia to-violet" />
        <span className="eyebrow">Why this works</span>
        <ProvenanceBadge provenance={provenance} />
      </div>

      {summary ? (
        <p className="mt-3 text-[17px] leading-[1.65] tracking-tight text-ink">{summary}</p>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">No synthesis was produced for this reference.</p>
      )}

      {mechanisms.length > 0 && (
        <ul className="mt-6 space-y-3">
          {mechanisms.map((m, i) => (
            <ClaimRow key={i} claim={m} observationById={observationById} />
          ))}
        </ul>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <ClaimGroup
          title="Creates tension"
          claims={dna.creative_interpretation.what_creates_tension}
          observationById={observationById}
        />
        <ClaimGroup
          title="Creates release"
          claims={dna.creative_interpretation.what_creates_release}
          observationById={observationById}
        />
      </div>

      {dna.creative_interpretation.most_distinctive_choices.length > 0 && (
        <div className="mt-8">
          <div className="eyebrow mb-2.5">Most distinctive choices</div>
          <ul className="space-y-3">
            {dna.creative_interpretation.most_distinctive_choices.map((c, i) => (
              <ClaimRow key={i} claim={c} observationById={observationById} />
            ))}
          </ul>
        </div>
      )}

      {(dna.uncertainty.unmeasurable.length > 0 || dna.uncertainty.low_confidence_areas.length > 0) && (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-4/50 px-4 py-3.5">
          <div className="eyebrow mb-2 text-ink-4">What this analysis cannot tell you</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {dna.uncertainty.unmeasurable.length > 0 && (
              <ul className="space-y-1">
                {dna.uncertainty.unmeasurable.map((u, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-ink-4">
                    · {u}
                  </li>
                ))}
              </ul>
            )}
            {dna.uncertainty.low_confidence_areas.length > 0 && (
              <ul className="space-y-1">
                {dna.uncertainty.low_confidence_areas.map((u, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-warn/80">
                    · {u}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {dna.creative_interpretation.what_not_to_copy.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Keep original — do not reproduce</div>
          <div className="flex flex-wrap gap-1.5">
            {dna.creative_interpretation.what_not_to_copy.map((v, i) => (
              <span key={i} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3">
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-[11px] text-ink-4 hover:text-ink-3">
            {issues.length} note{issues.length === 1 ? "" : "s"} about how this profile was generated
          </summary>
          <ul className="mt-2 space-y-1">
            {issues.map((it, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-ink-4">
                · {it}
              </li>
            ))}
          </ul>
        </details>
      )}
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
      <div className="eyebrow mb-2.5">{title}</div>
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
    <li className="border-l border-line-bright pl-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13.5px] leading-relaxed text-ink-2">{claim.claim}</p>
        {claim.confidence !== null && <ConfidenceChip value={claim.confidence} />}
      </div>
      <EvidenceList ids={claim.evidence} observationById={observationById} />
    </li>
  );
}

function EvidenceList({
  ids,
  observationById,
}: {
  ids: string[];
  observationById: Map<string, { text: string }>;
}) {
  const resolved = ids.map((id) => observationById.get(id)).filter((o): o is { text: string } => !!o);

  if (resolved.length === 0) {
    return <div className="mt-1 text-[10.5px] italic text-ink-4">Interpretation only — no measurement cited.</div>;
  }

  return (
    <ul className="mt-1 space-y-0.5">
      {resolved.map((o, i) => (
        <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-4">
          <span className="shrink-0 text-ink-4/70">measured ·</span>
          <span>{o.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ConfidenceChip({ value }: { value: number }) {
  const tone = value >= 0.7 ? "text-good" : value >= 0.45 ? "text-ink-3" : "text-warn";
  return (
    <span className={`tnum shrink-0 text-[10px] ${tone}`} title="Model confidence">
      {value.toFixed(2)}
    </span>
  );
}

function ProvenanceBadge({ provenance }: { provenance: DnaProvenance | null }) {
  if (!provenance) return null;
  if (provenance.heuristic) {
    return (
      <span className="rounded-full border border-warn/40 bg-warn/5 px-2 py-0.5 text-[10px] text-warn">
        Built-in rules — no language model
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
      {provenance.provider}
      {provenance.model ? ` · ${provenance.model}` : ""}
    </span>
  );
}
