"use client";

/**
 * Progressive disclosure for a completed Soundprint.
 *
 * Soundprint is an instrument, not an analysis report: this is the state
 * machine that keeps a completed reference to roughly 5-7 visible objects by
 * default while every piece of the existing detailed output — full DiscoveryField,
 * full Why This Works, raw measurements, exact confidence numbers, comparative
 * context, limitations — stays exactly one click away, unregenerated.
 *
 * Nothing here is a route change. SUMMARY → TRAIT → EVIDENCE is local state,
 * so selecting a trait from the constellation and then opening its evidence
 * never loses the object or scroll position the way a page navigation would.
 * The spatial objects (the discovery chips themselves, plus a small set of
 * labelled entrance pills) are the only navigation — no tabs, no accordions,
 * no card grid.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { EnergyTimeline } from "@/components/EnergyTimeline";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import type { WorldContextRow } from "@/lib/baseline/contextualize";
import type { Claim, DnaProvenance, SoundDna } from "@/lib/dna/schema";
import { confidenceLabel } from "@/lib/format/confidence";
import type { DiscoveryNode } from "@/lib/spatial/orbit";

import { DiscoveryField } from "./DiscoveryField";
import { LiquidObject } from "./LiquidObject";
import { SignatureTraitsStrip } from "./SignatureTraitsStrip";
import { WhyThisWorksField } from "./WhyThisWorksField";
import { WorldContextStrip } from "./WorldContextStrip";

type View = "summary" | "explore" | "timeline" | "evidence" | "limits" | "trait";

export function SoundprintExperience({
  referenceId,
  seed,
  knowledge,
  summaryDiscoveries,
  fullDiscoveries,
  whyShort,
  whySummaryWasTruncated,
  provenance,
  dna,
  dnaIssues,
  analysis,
  contextHighlights,
}: {
  referenceId: string;
  seed: string;
  knowledge: number;
  summaryDiscoveries: DiscoveryNode[];
  fullDiscoveries: DiscoveryNode[];
  whyShort: string | null;
  whySummaryWasTruncated: boolean;
  provenance: DnaProvenance | null;
  dna: SoundDna;
  dnaIssues: string[];
  analysis: ObjectiveAnalysis;
  contextHighlights: WorldContextRow[];
}) {
  const [view, setView] = useState<View>("summary");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const observationById = useMemo(
    () => new Map(analysis.observations.map((o) => [o.id, o])),
    [analysis.observations],
  );
  const nodeById = useMemo(() => {
    const m = new Map<string, DiscoveryNode>();
    for (const n of fullDiscoveries) m.set(n.id, n);
    for (const n of summaryDiscoveries) if (!m.has(n.id)) m.set(n.id, n);
    return m;
  }, [fullDiscoveries, summaryDiscoveries]);

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const activeNodes = view === "explore" || view === "trait" ? fullDiscoveries : summaryDiscoveries;

  function inspect(id: string) {
    setSelectedId(id);
    setView("trait");
  }

  const distinctive = dna.creative_interpretation.most_distinctive_choices;

  return (
    <div>
      {/* ------------------------------------------------------------- THE FIELD */}
      <div className="sp-field relative mx-auto flex min-h-[420px] items-center justify-center sm:min-h-[600px] md:min-h-[700px] lg:min-h-[760px]">
        <LiquidObject
          seed={seed}
          knowledge={knowledge}
          active={false}
          className="relative z-10 h-[120px] w-[120px] sm:h-[230px] sm:w-[230px] md:h-[270px] md:w-[270px]"
        />
        <DiscoveryField
          nodes={activeNodes}
          seed={seed}
          onSelect={inspect}
          selectedId={selectedId}
          // The 5-7 summary objects are already priority-ordered (tempo, key,
          // strongest comparative finding, then traits); on a phone-width
          // field even 7 of them at full readable size collide, so mobile
          // gets the top 4 — "the essence within roughly one viewport" — and
          // the rest are a tap away via Explore DNA, not lost.
          mobileVisibleCount={view === "explore" ? 5 : 3}
        />
      </div>

      {/* ------------------------------------------------------- ENTRANCE PILLS
          The spatial objects are the navigation. These are the only "menu"
          this page has, and they're small, labelled, and non-modal. */}
      <nav className="mx-auto mt-2 flex max-w-2xl flex-wrap items-center justify-center gap-2">
        <EntrancePill active={view === "summary"} onClick={() => setView("summary")}>
          Overview
        </EntrancePill>
        <EntrancePill active={view === "explore"} onClick={() => setView("explore")}>
          Explore DNA
        </EntrancePill>
        <EntrancePill active={view === "timeline"} onClick={() => setView("timeline")}>
          Timeline
        </EntrancePill>
        <EntrancePill active={view === "evidence"} onClick={() => setView("evidence")}>
          Evidence
        </EntrancePill>
        <EntrancePill active={view === "limits"} onClick={() => setView("limits")}>
          What Soundprint can&rsquo;t tell
        </EntrancePill>
        <Link
          href={`/references/${referenceId}/prompt`}
          className="rounded-full bg-signal px-3.5 py-1.5 text-[12.5px] font-medium text-[#14060f] transition-opacity hover:opacity-90"
        >
          Create
        </Link>
      </nav>

      {/* ------------------------------------------------------------- CONTENT */}
      <div className="mx-auto mt-8 max-w-2xl">
        {view === "summary" && (
          <SummaryView
            whyShort={whyShort}
            truncated={whySummaryWasTruncated}
            distinctive={distinctive}
            onReadFull={() => setView("explore")}
          />
        )}

        {view === "trait" && selectedNode && (
          <TraitInspector
            node={selectedNode}
            observationById={observationById}
            onBack={() => setView("summary")}
            onOpenEvidence={() => setView("evidence")}
          />
        )}

        {view === "explore" && (
          <div className="space-y-10">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Every discovery on this Soundprint</div>
              <button onClick={() => setView("summary")} className="text-[12px] text-signal hover:underline">
                ← Back to overview
              </button>
            </div>
            <SignatureTraitsStrip traits={dna.signature_traits} />
            <WhyThisWorksField dna={dna} provenance={provenance} issues={dnaIssues} analysis={analysis} />
          </div>
        )}

        {view === "timeline" && (
          <div className="space-y-4">
            <button onClick={() => setView("summary")} className="text-[12px] text-signal hover:underline">
              ← Back to overview
            </button>
            <EnergyTimeline analysis={analysis} />
          </div>
        )}

        {view === "evidence" && (
          <div className="space-y-8">
            <button onClick={() => setView("summary")} className="text-[12px] text-signal hover:underline">
              ← Back to overview
            </button>
            <WorldContextStrip highlights={contextHighlights} />
            <TechnicalPanel analysis={analysis} dna={dna} />
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/references/${referenceId}/export?format=json`}
                className="rounded-full border border-line px-3.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
              >
                Download Sound DNA (JSON)
              </a>
              <a
                href={`/api/references/${referenceId}/export?format=analysis`}
                className="rounded-full border border-line px-3.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
              >
                Download raw analysis (JSON)
              </a>
            </div>
          </div>
        )}

        {view === "limits" && (
          <LimitsView dna={dna} onBack={() => setView("summary")} />
        )}
      </div>
    </div>
  );
}

function EntrancePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors ${
        active
          ? "border-fuchsia/50 bg-signal-wash text-ink"
          : "border-line bg-surface/70 text-ink-2 hover:border-line-bright hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryView({
  whyShort,
  truncated,
  distinctive,
  onReadFull,
}: {
  whyShort: string | null;
  truncated: boolean;
  distinctive: Claim[];
  onReadFull: () => void;
}) {
  const top = distinctive.slice(0, 3);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-gradient-to-r from-fuchsia to-violet" />
          <span className="eyebrow">Why this works</span>
        </div>
        {whyShort ? (
          <p className="mt-3 text-[16px] leading-[1.65] tracking-tight text-ink sm:text-[17px]">{whyShort}</p>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3">No synthesis was produced for this reference.</p>
        )}
        {truncated && (
          <button onClick={onReadFull} className="mt-3 text-[12.5px] text-signal hover:underline">
            Read the full analysis →
          </button>
        )}
      </section>

      {top.length > 0 && (
        <section>
          <div className="eyebrow mb-2.5">Distinctive</div>
          <ul className="space-y-2.5">
            {top.map((c, i) => (
              <li key={i} className="border-l border-line-bright pl-3.5">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{c.claim}</p>
              </li>
            ))}
          </ul>
          {distinctive.length > top.length && (
            <button onClick={onReadFull} className="mt-2.5 text-[12px] text-signal hover:underline">
              Explore {distinctive.length - top.length} more →
            </button>
          )}
        </section>
      )}

      <p className="text-center text-[11.5px] text-ink-4">
        Tap a discovery above to inspect it, or use a label below to go deeper.
      </p>
    </div>
  );
}

function TraitInspector({
  node,
  observationById,
  onBack,
  onOpenEvidence,
}: {
  node: DiscoveryNode;
  observationById: Map<string, { text: string }>;
  onBack: () => void;
  onOpenEvidence: () => void;
}) {
  const conf = confidenceLabel(node.confidence ?? null);
  const evidence = (node.evidenceIds ?? [])
    .map((id) => observationById.get(id))
    .filter((o): o is { text: string } => !!o);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-[12px] text-signal hover:underline">
        ← Back to overview
      </button>

      <div>
        <div className="eyebrow mb-1">{KIND_TITLE[node.kind]}</div>
        <h2 className="text-[20px] font-semibold leading-snug tracking-tight text-ink">{node.label}</h2>
        {node.detail && node.detail !== node.label && (
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{node.detail}</p>
        )}
        {node.populationHint && (
          <p className="mt-1.5 text-[12px] text-ink-4">Compared against {node.populationHint}.</p>
        )}
        {conf && <p className={`mt-2 text-[12px] ${conf.className}`}>{conf.label}</p>}
      </div>

      {evidence.length > 0 ? (
        <div>
          <div className="eyebrow mb-2">Measured evidence</div>
          <ul className="space-y-1.5">
            {evidence.map((o, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-ink-3">
                · {o.text}
              </li>
            ))}
          </ul>
        </div>
      ) : node.kind === "interpreted" ? (
        <p className="text-[11.5px] italic text-ink-4">Interpretation only — no specific measurement cited.</p>
      ) : null}

      <button onClick={onOpenEvidence} className="text-[12px] text-signal hover:underline">
        Open full Evidence →
      </button>
    </div>
  );
}

const KIND_TITLE: Record<DiscoveryNode["kind"], string> = {
  observed: "Measured",
  comparative: "Comparative finding",
  interpreted: "Interpreted reading",
  uncertain: "Uncertain",
};

function LimitsView({ dna, onBack }: { dna: SoundDna; onBack: () => void }) {
  const { unmeasurable, low_confidence_areas, notes } = dna.uncertainty;
  const empty = unmeasurable.length === 0 && low_confidence_areas.length === 0 && !notes;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-[12px] text-signal hover:underline">
        ← Back to overview
      </button>
      <div>
        <div className="eyebrow mb-2">What Soundprint can&rsquo;t tell you</div>
        {empty ? (
          <p className="text-[13px] text-ink-3">No specific gaps were flagged for this reference.</p>
        ) : (
          <div className="space-y-4">
            {unmeasurable.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11.5px] font-medium text-ink-3">Not measurable</div>
                <ul className="space-y-1">
                  {unmeasurable.map((u, i) => (
                    <li key={i} className="text-[12.5px] leading-relaxed text-ink-3">
                      · {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {low_confidence_areas.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11.5px] font-medium text-warn">Low confidence</div>
                <ul className="space-y-1">
                  {low_confidence_areas.map((u, i) => (
                    <li key={i} className="text-[12.5px] leading-relaxed text-ink-3">
                      · {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {notes && <p className="text-[12.5px] leading-relaxed text-ink-3">{notes}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
