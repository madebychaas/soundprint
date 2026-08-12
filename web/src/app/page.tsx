import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";

import { NewProjectForm } from "@/components/NewProjectForm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      description: schema.projects.description,
      updatedAt: schema.projects.updatedAt,
      // The inner table is aliased and the outer column is fully qualified on
      // purpose. Interpolating the column via drizzle renders it unqualified
      // ("id"), which SQLite resolves against the *inner* table — "references"
      // also has an id column — so the correlation silently compared
      // project_id to references.id and every count came back 0.
      referenceCount: sql<number>`(
        SELECT COUNT(*) FROM "references" r WHERE r.project_id = "projects"."id"
      )`,
      completeCount: sql<number>`(
        SELECT COUNT(*) FROM "references" r
        WHERE r.project_id = "projects"."id"
          AND r.status IN ('complete','partial')
      )`,
    })
    .from(schema.projects)
    .orderBy(desc(schema.projects.updatedAt))
    .all();

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <section>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-2">
            A project groups reference tracks you want to learn from. Upload one to see what
            it is doing; upload several to see what they have in common.
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="rounded border border-dashed border-line px-6 py-14 text-center">
            <p className="text-[13px] text-ink-2">No projects yet.</p>
            <p className="mt-1 text-[12px] text-ink-4">
              Create one to the right — &ldquo;Dark pop references&rdquo; is a good first name.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded border border-line">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{p.name}</div>
                    {p.description && (
                      <div className="mt-0.5 truncate text-[12px] text-ink-3">{p.description}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tnum text-[12px] text-ink-2">
                      {p.referenceCount} reference{p.referenceCount === 1 ? "" : "s"}
                    </div>
                    {p.referenceCount > 0 && (
                      <div className="tnum text-[11px] text-ink-4">
                        {p.completeCount}/{p.referenceCount} analysed
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside>
        <NewProjectForm />
      </aside>
    </div>
  );
}
