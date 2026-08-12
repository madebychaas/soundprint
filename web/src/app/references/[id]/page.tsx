import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { NotesPanel } from "@/components/NotesPanel";
import { RatingControl } from "@/components/RatingControl";
import { ReferenceActions } from "@/components/ReferenceActions";
import { DiscoveryField } from "@/components/spatial/DiscoveryField";
import { LiquidObject } from "@/components/spatial/LiquidObject";
import { LiveStatusBanner } from "@/components/spatial/LiveStatusBanner";
import { SoundprintExperience } from "@/components/spatial/SoundprintExperience";
import { comparativeObservations, semanticLabelsFor } from "@/lib/baseline/observations";
import { distinctiveHighlights, resolveWorldContextRows } from "@/lib/baseline/contextualize";
import { db, schema } from "@/lib/db";
import { loadReference } from "@/lib/pipeline";
import { formatTime } from "@/lib/analysis/types";
import { buildDiscoveries, buildSummaryDiscoveries, knowledgeLevel, shortSummary } from "@/lib/spatial/discoveries";

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
  // Resolved to plain data here, on the server: SoundprintExperience is a
  // client component, and anything importing contextualize.ts's runtime code
  // (primaryContext, etc.) pulls the SQLite baseline client's node:fs usage
  // into the browser bundle. See resolveWorldContextRows.
  const contextHighlights = resolveWorldContextRows(distinctiveHighlights(comparative.contexts, 4));

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

      {dna && analysis ? (
        // Resolved: progressive disclosure takes over. See SoundprintExperience —
        // this is deliberately not the same always-expanded stack the working
        // state below uses; a completed Soundprint is an instrument, not a report.
        <SoundprintExperience
          referenceId={id}
          seed={id}
          knowledge={knowledge}
          summaryDiscoveries={buildSummaryDiscoveries({ analysis, dna, comparative: comparative.contexts })}
          fullDiscoveries={buildDiscoveries({ analysis, dna, comparative: comparative.contexts })}
          whyShort={shortSummary(dna.why_this_works.summary)}
          whySummaryWasTruncated={
            shortSummary(dna.why_this_works.summary) !== (dna.why_this_works.summary?.trim() ?? null)
          }
          provenance={provenance}
          dna={dna}
          dnaIssues={dnaIssues}
          analysis={analysis}
          contextHighlights={contextHighlights}
        />
      ) : (
        // Intake → analysis → orbit, before resolution. Nothing to disclose
        // progressively yet — discoveries appear around the object exactly as
        // the real pipeline state allows, never before.
        <>
          <div className="relative mx-auto flex min-h-[420px] items-center justify-center sm:min-h-[600px] md:min-h-[700px] lg:min-h-[760px]">
            <LiquidObject
              seed={id}
              knowledge={knowledge}
              active={working}
              className="relative z-10 h-[120px] w-[120px] sm:h-[230px] sm:w-[230px] md:h-[270px] md:w-[270px]"
            />
            {analysis && (
              <DiscoveryField nodes={buildDiscoveries({ analysis, dna, comparative: comparative.contexts })} seed={id} />
            )}
          </div>
          {!analysis && !working && (
            <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-3">
              No analysis available for this reference.
            </div>
          )}
        </>
      )}

      {/* --------------------------------------------------------- notes */}
      <div className="mx-auto mt-10 max-w-2xl">
        <NotesPanel referenceId={id} notes={notes.map((n) => ({ id: n.id, body: n.body }))} />
      </div>
    </div>
  );
}
