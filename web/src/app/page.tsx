import Link from "next/link";
import { desc, sql } from "drizzle-orm";

import { NewProjectForm } from "@/components/NewProjectForm";
import { QuickIntakeField } from "@/components/spatial/QuickIntakeField";
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
    <div>
      {/* THE FIRST THING ON THE PAGE. Drop a sound, or choose a file — the
          object supports that action, it is not the thing you have to
          understand before you can act. Lands in the most recently used
          project automatically; creates a first one silently if none exist.
          Full width on purpose: this is the first major horizontal field
          below the nav, not a narrow centered hero. */}
      <div className="mt-2">
        <QuickIntakeField defaultProjectId={projects[0]?.id ?? null} />
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-10 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-3 flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-fuchsia to-violet" />
            <span className="eyebrow">Your sounds</span>
          </div>

          {projects.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-ink-4">
              Nothing yet — drop a track above and it starts here.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
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
          <div className="mb-3 flex items-center gap-3">
            <span className="h-px w-6 bg-line-bright" />
            <span className="eyebrow">Or start a named project</span>
          </div>
          <NewProjectForm />
        </aside>
      </div>
    </div>
  );
}
