import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { ReferenceList } from "@/components/ReferenceList";
import { UploadPanel } from "@/components/UploadPanel";
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
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-[12px] text-ink-3 hover:text-ink-2">
            ← Projects
          </Link>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-2">
              {project.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {analysed.length >= 2 && (
            <Link
              href={`/projects/${id}/compare`}
              className="rounded border border-line px-3 py-2 text-[13px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
            >
              Compare {analysed.length} references
            </Link>
          )}
          {analysed.length >= 1 && (
            <Link
              href={`/projects/${id}/prompt`}
              className="rounded bg-signal px-3 py-2 text-[13px] font-medium text-[#14100a] transition-opacity hover:opacity-90"
            >
              Prompt Studio
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
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

        <aside>
          <UploadPanel projectId={id} />
        </aside>
      </div>
    </div>
  );
}
