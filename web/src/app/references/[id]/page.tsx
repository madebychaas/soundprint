import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { EnergyTimeline } from "@/components/EnergyTimeline";
import { NotesPanel } from "@/components/NotesPanel";
import { RatingControl } from "@/components/RatingControl";
import { ReferenceActions } from "@/components/ReferenceActions";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import { DiscoveryField } from "@/components/spatial/DiscoveryField";
import { LiquidObject } from "@/components/spatial/LiquidObject";
import { LiveStatusBanner } from "@/components/spatial/LiveStatusBanner";
import { SignatureTraitsStrip } from "@/components/spatial/SignatureTraitsStrip";
import { TechnicalDrawer } from "@/components/spatial/TechnicalDrawer";
import { WhyThisWorksField } from "@/components/spatial/WhyThisWorksField";
import { WorldContextStrip } from "@/components/spatial/WorldContextStrip";
import { comparativeObservations, semanticLabelsFor } from "@/lib/baseline/observations";
import { distinctiveHighlights } from "@/lib/baseline/contextualize";
import { db, schema } from "@/lib/db";
import { loadReference } from "@/lib/pipeline";
import { formatTime } from "@/lib/analysis/types";
import { buildDiscoveries, knowledgeLevel } from "@/lib/spatial/discoveries";

export const dynamic = "force-dynamic";

export default async function ReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = loadReference(id);
  if (!loaded) notFound();

  const { reference, analysis, dna, provenance, dnaIssues, notes, rating } = loaded;
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, reference.projectId))
    .get();

  const working = ["uploaded", "analyzing", "interpreting"].includes(reference.status);

  // Comparative context, computed at the presentation boundary exactly as the
  // pipeline computes it for interpretation (`comparativeObservations`) — this
  // never touches the stored analysis, it only reads it. See
  // lib/baseline/observations.ts for why the same shape is reused rather than
  // inventing a second comparison path.
  const comparative = analysis
    ? comparativeObservations(analysis, { semanticLabels: semanticLabelsFor(analysis) })
    : { observations: [], contexts: [], baselineVersion: null };
  const contextHighlights = distinctiveHighlights(comparative.contexts, 4);

  const discoveries = buildDiscoveries({ analysis, dna, comparative: comparative.contexts });
  const knowledge = knowledgeLevel(analysis, dna);

  return (
    <div>
      <header className="mb-2 mt-3">
        <Link href={`/projects/${reference.projectId}`} className="text-[12px] text-ink-3 hover:text-ink-2">
          ← {project?.name ?? "Project"}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{reference.title}</h1>
            <p className="mt-1 text-[12px] text-ink-4">
              {reference.artist ? `${reference.artist} · ` : ""}
              {reference.sourceFilename}
              {analysis ? ` · ${formatTime(analysis.metadata.duration_seconds)}` : ""}
              {analysis?.metadata.is_true_stereo === false ? " · mono" : ""}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <RatingControl referenceId={id} initial={rating} />
            <ReferenceActions referenceId={id} projectId={reference.projectId} />
          </div>
        </div>
      </header>

      {working && (
        <LiveStatusBanner referenceId={id} status={reference.status} detail={reference.statusDetail} />
      )}

      {reference.status === "failed" && (
        <div className="mb-6 rounded-2xl border border-bad/40 bg-bad/5 p-4">
          <div className="text-[13px] font-medium text-bad">Analysis failed</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{reference.errorMessage}</p>
        </div>
      )}

      {analysis && analysis.warnings.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warn/30 bg-warn/5 p-4">
          <div className="eyebrow mb-2 text-warn">Analysis caveats</div>
          <ul className="space-y-1">
            {analysis.warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-ink-2">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* -------------------------------------------------------------- 1. THE OBJECT
          Intake → analysis → orbit → resolution, all in one field. The object
          itself is present the instant the page renders, even before a single
          measurement exists — discoveries appear around it as the real
          pipeline state allows, never before. */}
      <div className="sp-field relative mx-auto flex min-h-[380px] items-center justify-center sm:min-h-[520px] md:min-h-[600px]">
        <LiquidObject
          seed={id}
          knowledge={knowledge}
          active={working}
          className="relative z-10 h-[150px] w-[150px] sm:h-[210px] sm:w-[210px] md:h-[250px] md:w-[250px]"
        />
        {discoveries.length > 0 && <DiscoveryField nodes={discoveries} seed={id} />}
      </div>

      {/* ------------------------------------------------------- 2-4. RESOLUTION */}
      {dna && (
        <div className="mt-6 space-y-10">
          <WhyThisWorksField dna={dna} provenance={provenance} issues={dnaIssues} analysis={analysis} />
          <SignatureTraitsStrip traits={dna.signature_traits} />
          <WorldContextStrip highlights={contextHighlights} />
        </div>
      )}

      {analysis && (
        <div className="mx-auto mt-10 max-w-4xl">
          <EnergyTimeline analysis={analysis} />
        </div>
      )}

      {/* --------------------------------------------------- 5. deeper measurements */}
      {analysis ? (
        <div className="mx-auto mt-6 max-w-4xl">
          <TechnicalDrawer>
            <TechnicalPanel analysis={analysis} dna={dna} />
          </TechnicalDrawer>
        </div>
      ) : (
        !working && (
          <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-3">
            No analysis available for this reference.
          </div>
        )
      )}

      {/* --------------------------------------------------------- 6. notes/export */}
      <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-2">
        <NotesPanel referenceId={id} notes={notes.map((n) => ({ id: n.id, body: n.body }))} />

        {analysis && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="eyebrow mb-3">Export</div>
            <div className="space-y-2">
              <Link
                href={`/references/${id}/prompt`}
                className="block rounded-full bg-signal px-3 py-2 text-center text-[13px] font-medium text-[#14060f] transition-opacity hover:opacity-90"
              >
                Open Prompt Studio
              </Link>
              <a
                href={`/api/references/${id}/export?format=json`}
                className="block rounded-full border border-line px-3 py-2 text-center text-[13px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
              >
                Download Sound DNA (JSON)
              </a>
              <a
                href={`/api/references/${id}/export?format=analysis`}
                className="block rounded-full border border-line px-3 py-2 text-center text-[13px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
              >
                Download raw analysis (JSON)
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
