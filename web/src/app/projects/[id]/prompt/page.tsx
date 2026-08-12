import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { PromptStudio } from "@/components/PromptStudio";
import { db, schema } from "@/lib/db";
import { loadProjectReferences } from "@/lib/pipeline";
import { loadTasteProfile } from "@/lib/taste/engine";

export const dynamic = "force-dynamic";

export default async function ProjectPromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) notFound();

  const analysed = loadProjectReferences(id).filter((r) => r.dna && r.analysis);
  if (analysed.length === 0) {
    return (
      <div className="rounded border border-line bg-surface px-6 py-12 text-center">
        <p className="text-[13px] text-ink-2">No analysed references in this project yet.</p>
        <Link
          href={`/projects/${id}`}
          className="mt-3 inline-block text-[12.5px] text-signal hover:underline"
        >
          Back to the project
        </Link>
      </div>
    );
  }

  const taste = loadTasteProfile();

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-[12px] text-ink-3 hover:text-ink-2">
        ← {project.name}
      </Link>
      <div className="mt-1.5">
        <PromptStudio
          projectId={id}
          title="Prompt Studio"
          subtitle={
            analysed.length > 1
              ? `Built from what ${analysed.length} references have in common, not from any single one.`
              : "Built from the single analysed reference in this project."
          }
          hasTasteProfile={taste.traits.length > 0}
        />
      </div>
    </div>
  );
}
