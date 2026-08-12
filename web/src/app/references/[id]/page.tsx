import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { EnergyTimeline } from "@/components/EnergyTimeline";
import { NotesPanel } from "@/components/NotesPanel";
import { RatingControl } from "@/components/RatingControl";
import { ReferenceActions } from "@/components/ReferenceActions";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import { WhyThisWorks } from "@/components/WhyThisWorks";
import { db, schema } from "@/lib/db";
import { loadReference } from "@/lib/pipeline";
import { formatTime } from "@/lib/analysis/types";

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

  return (
    <div>
      <header className="mb-6">
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

      {working && <WorkingBanner detail={reference.statusDetail} />}

      {reference.status === "failed" && (
        <div className="mb-6 rounded border border-bad/40 bg-bad/5 p-4">
          <div className="text-[13px] font-medium text-bad">Analysis failed</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{reference.errorMessage}</p>
        </div>
      )}

      {analysis && analysis.warnings.length > 0 && (
        <div className="mb-6 rounded border border-warn/30 bg-warn/5 p-4">
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

      {analysis && (
        <div className="mb-8">
          <EnergyTimeline analysis={analysis} />
        </div>
      )}

      {dna && (
        <div className="mb-8">
          <WhyThisWorks dna={dna} provenance={provenance} issues={dnaIssues} analysis={analysis} />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {analysis ? (
            <TechnicalPanel analysis={analysis} dna={dna} />
          ) : (
            !working && (
              <div className="rounded border border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-3">
                No analysis available for this reference.
              </div>
            )
          )}
        </div>

        <aside className="space-y-6">
          <NotesPanel referenceId={id} notes={notes.map((n) => ({ id: n.id, body: n.body }))} />

          {analysis && (
            <div className="rounded border border-line bg-surface p-4">
              <div className="eyebrow mb-3">Export</div>
              <div className="space-y-2">
                <Link
                  href={`/references/${id}/prompt`}
                  className="block rounded bg-signal px-3 py-2 text-center text-[13px] font-medium text-[#14100a] transition-opacity hover:opacity-90"
                >
                  Open Prompt Studio
                </Link>
                <a
                  href={`/api/references/${id}/export?format=json`}
                  className="block rounded border border-line px-3 py-2 text-center text-[13px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
                >
                  Download Sound DNA (JSON)
                </a>
                <a
                  href={`/api/references/${id}/export?format=analysis`}
                  className="block rounded border border-line px-3 py-2 text-center text-[13px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
                >
                  Download raw analysis (JSON)
                </a>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function WorkingBanner({ detail }: { detail: string | null }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded border border-line bg-surface p-4">
      <span className="h-1.5 w-1.5 animate-working rounded-full bg-signal" />
      <div>
        <div className="text-[13px] font-medium">{detail ?? "Working…"}</div>
        <p className="mt-0.5 text-[11.5px] text-ink-4">
          Measurement takes roughly 20-40 seconds for a full-length track. This page updates
          automatically.
        </p>
      </div>
      <AutoRefresh />
    </div>
  );
}

function AutoRefresh() {
  // Server component: a meta refresh avoids shipping a client component whose
  // only job is to reload a page that is already server-rendered.
  return <meta httpEquiv="refresh" content="4" />;
}
