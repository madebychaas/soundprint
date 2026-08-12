import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { compareReferences } from "@/lib/comparison/engine";
import { loadProjectReferences } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) notFound();

  const refs = loadProjectReferences(id).filter((r) => r.analysis);

  if (refs.length < 2) {
    return (
      <div>
        <Link href={`/projects/${id}`} className="text-[12px] text-ink-3 hover:text-ink-2">
          ← {project.name}
        </Link>
        <div className="mt-6 rounded border border-dashed border-line px-6 py-14 text-center">
          <p className="text-[13px] text-ink-2">
            Comparison needs at least two analysed references.
          </p>
          <p className="mt-1 text-[12px] text-ink-4">
            This project has {refs.length}.
          </p>
        </div>
      </div>
    );
  }

  const result = compareReferences(
    refs.map((r) => ({
      referenceId: r.reference.id,
      title: r.reference.title,
      analysis: r.analysis!,
      dna: r.dna,
    })),
  );

  return (
    <div>
      <Link href={`/projects/${id}`} className="text-[12px] text-ink-3 hover:text-ink-2">
        ← {project.name}
      </Link>

      <header className="mb-7 mt-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">What persists across these tracks</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink-2">{result.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {refs.map((r) => (
            <Link
              key={r.reference.id}
              href={`/references/${r.reference.id}`}
              className="rounded border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-line-bright hover:text-ink"
            >
              {r.reference.title}
              {r.analysis?.tempo.bpm ? (
                <span className="tnum ml-1.5 text-ink-4">{Math.round(r.analysis.tempo.bpm)}</span>
              ) : null}
            </Link>
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Common DNA"
          subtitle="Present across the set — this is what you are actually after"
          accent="good"
        >
          {result.shared.length === 0 ? (
            <Empty>Nothing measurable is shared across all of these.</Empty>
          ) : (
            <ul className="divide-y divide-line/50">
              {result.shared.map((s) => (
                <li key={s.dimension} className="flex items-baseline gap-3 px-4 py-2.5">
                  <span className="w-[130px] shrink-0 text-[11.5px] text-ink-4">{s.label}</span>
                  <span className="flex-1 text-[13px] text-ink">{s.value}</span>
                  <span
                    className="tnum shrink-0 text-[10.5px] text-ink-4"
                    title={
                      s.referenceCount < refs.length
                        ? `Only ${s.referenceCount} of ${refs.length} references could be measured on this dimension`
                        : undefined
                    }
                  >
                    {/* "all" is reserved for dimensions every reference could
                        answer; otherwise show the measurable denominator so a
                        2-of-3 agreement is never read as unanimous. */}
                    {s.agreement === 1 && s.referenceCount === refs.length
                      ? "all"
                      : `${Math.round(s.agreement * s.referenceCount)}/${s.referenceCount}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Likely taste signals"
          subtitle="What the shared traits suggest about you rather than the audio"
          accent="signal"
        >
          {result.preferenceSignals.length === 0 ? (
            <Empty>Not enough agreement yet to infer a preference.</Empty>
          ) : (
            <ul className="divide-y divide-line/50">
              {result.preferenceSignals.map((s, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] leading-snug text-ink">{s.signal}</span>
                    <span className="tnum shrink-0 text-[10.5px] text-ink-4">
                      {s.confidence.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-4">{s.basis}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Unique to one reference"
          subtitle="That song's own character — not a pattern in your taste"
          accent="info"
        >
          {result.unique.length === 0 ? (
            <Empty>No single reference stands apart on any measured dimension.</Empty>
          ) : (
            <ul className="divide-y divide-line/50">
              {result.unique.map((u, i) => (
                <li key={i} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{u.title}</span>
                    <span className="text-[11px] text-ink-4">{u.label}</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-2">
                    {u.value}
                    <span className="text-ink-4"> — the others are {u.othersValue}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Contradictions"
          subtitle="Where your references genuinely disagree — decide deliberately"
          accent="warn"
        >
          {result.contradictions.length === 0 ? (
            <Empty>No direct contradictions between these references.</Empty>
          ) : (
            <ul className="divide-y divide-line/50">
              {result.contradictions.map((c) => (
                <li key={c.dimension} className="px-4 py-3">
                  <div className="text-[12px] font-medium text-warn">{c.label}</div>
                  <div className="mt-1.5 space-y-1">
                    {c.groups.map((g, i) => (
                      <div key={i} className="flex gap-2 text-[12.5px]">
                        <span className="text-ink">{g.value}</span>
                        <span className="text-ink-4">
                          — {g.references.map((r) => r.title).join(", ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <Panel
            title="Not shared"
            subtitle="Varies without a pattern — safe to change freely"
            accent="muted"
          >
            {result.notShared.length === 0 ? (
              <Empty>Nothing notable varies across the set.</Empty>
            ) : (
              <ul className="divide-y divide-line/50">
                {result.notShared.map((v) => (
                  <li key={v.dimension} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
                    <span className="w-[130px] shrink-0 text-[11.5px] text-ink-4">{v.label}</span>
                    <span className="text-[12.5px] text-ink-2">
                      {v.values.map((x) => `${x.title}: ${x.value}`).join("  ·  ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Link
          href={`/projects/${id}/prompt`}
          className="rounded bg-signal px-4 py-2 text-[13px] font-medium text-[#14100a] transition-opacity hover:opacity-90"
        >
          Build a prompt from the shared DNA
        </Link>
      </div>
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  good: "border-l-good",
  warn: "border-l-warn",
  info: "border-l-info",
  signal: "border-l-signal",
  muted: "border-l-line-bright",
};

function Panel({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: keyof typeof ACCENTS | string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded border border-line border-l-2 bg-surface ${ACCENTS[accent] ?? ""}`}
    >
      <div className="border-b border-line px-4 py-2.5">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[11px] text-ink-4">{subtitle}</div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 text-[12.5px] text-ink-4">{children}</p>;
}
