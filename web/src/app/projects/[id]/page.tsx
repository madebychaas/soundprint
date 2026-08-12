import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { ReferenceList } from "@/components/ReferenceList";
import { IntakeField } from "@/components/spatial/IntakeField";
import { db, schema } from "@/lib/db";
import { loadProjectReferences } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) notFound();

  const loaded = loadProjectReferences(id);
  const analysed = loaded.filter((r) => r.analysis !== null);

  return (
    <div>
      <header className="mb-2 mt-3">
        <Link href="/" className="text-[12px] text-ink-3 hover:text-ink-2">
          ← Sounds
        </Link>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.description && (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            {project.description}
          </p>
        )}
      </header>

      {/* THE INTAKE OBJECT — drop a track, or click through to what's already here. */}
      <div className="sp-field relative mx-auto flex min-h-[320px] items-center justify-center">
        <IntakeField projectId={id} />
      </div>

      {/* Compare/Create: lightweight labelled actions, contextual to this
          project, not a global sidebar entry. */}
      {(analysed.length >= 2 || analysed.length >= 1) && (
        <div className="mx-auto mt-2 flex flex-wrap items-center justify-center gap-2">
          {analysed.length >= 2 && (
            <Link
              href={`/projects/${id}/compare`}
              className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
            >
              Compare {analysed.length} references
            </Link>
          )}
          {analysed.length >= 1 && (
            <Link
              href={`/projects/${id}/prompt`}
              className="rounded-full bg-signal px-3.5 py-1.5 text-[12.5px] font-medium text-[#14060f] transition-opacity hover:opacity-90"
            >
              Create
            </Link>
          )}
        </div>
      )}

      <div className="mx-auto mt-10 max-w-4xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="h-px w-8 bg-gradient-to-r from-fuchsia to-violet" />
          <span className="eyebrow">Sounds in this project</span>
        </div>
        <ReferenceList
          projectId={id}
          initial={loaded.map((r) => ({
            id: r.reference.id,
            title: r.reference.title,
            artist: r.reference.artist,
            filename: r.reference.sourceFilename,
            status: r.reference.status,
            statusDetail: r.reference.statusDetail,
            error: r.reference.errorMessage,
            durationSeconds: r.reference.durationSeconds,
            rating: r.rating,
            bpm: r.analysis?.tempo.bpm ?? null,
            key: r.analysis?.tonal.key ?? null,
            mode: r.analysis?.tonal.mode ?? null,
            keyAmbiguous: r.analysis?.tonal.key_ambiguous ?? false,
            heuristic: r.provenance?.heuristic ?? null,
            warnings: r.analysis?.warnings.length ?? 0,
          }))}
        />
      </div>
    </div>
  );
}
