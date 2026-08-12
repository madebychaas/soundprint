/**
 * The orbit: discoveries positioned around the central object, with luminous
 * webbing drawn only where a real relationship exists in the data (see
 * `buildEdges`). Server-rendered — layout is pure CSS positioning + inline
 * SVG, so it appears with the rest of the page rather than after a client
 * script runs.
 *
 * Visual language per class, per the brief:
 *   observed     — small, tight, monospace-numeric, stable.
 *   comparative  — carries a percentile bar, connects to what it contextualises.
 *   interpreted  — larger, only present once DNA exists, softly glowing.
 *   uncertain    — dashed outline, dim, unmistakably provisional.
 */

import { buildEdges, layoutDiscoveries, type DiscoveryNode } from "@/lib/spatial/orbit";

const KIND_STYLE: Record<DiscoveryNode["kind"], string> = {
  observed: "border-line-bright/70 bg-surface-2/90 text-ink-2",
  comparative: "border-cobalt/40 bg-surface-2/90 text-ink-2",
  interpreted: "border-fuchsia/50 bg-gradient-to-br from-fuchsia/15 via-violet/10 to-surface-2/90 text-ink",
  uncertain: "border-dashed border-ink-4/60 bg-transparent text-ink-4",
};

const KIND_LABEL: Record<DiscoveryNode["kind"], string> = {
  observed: "measured",
  comparative: "context",
  interpreted: "reading",
  uncertain: "unclear",
};

export function DiscoveryField({
  nodes,
  seed,
  onNodeClick,
  mobileVisibleCount = 6,
}: {
  nodes: DiscoveryNode[];
  seed: string;
  /** Optional: id of a node to render as an <a href> target instead of a div (progressive disclosure anchors). */
  onNodeClick?: (id: string) => string | null;
  /** Nodes are already priority-ordered (interpreted → comparative → observed →
   * uncertain); beyond this index they're hidden on narrow viewports so a
   * phone never has to render 18 decorative chips at once. */
  mobileVisibleCount?: number;
}) {
  if (nodes.length === 0) return null;

  const positioned = layoutDiscoveries(nodes, seed);
  const edges = buildEdges(nodes);
  const byId = new Map(positioned.map((n) => [n.id, n]));

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="web-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-fuchsia)" />
            <stop offset="100%" stopColor="var(--color-cobalt)" />
          </linearGradient>
        </defs>
        {/* Every discovery threads back to the object itself. */}
        {positioned.map((n) => (
          <line
            key={`core-${n.id}`}
            x1="50%"
            y1="50%"
            x2={`${n.x}%`}
            y2={`${n.y}%`}
            stroke="url(#web-grad)"
            strokeWidth={n.kind === "interpreted" ? 1 : 0.6}
            opacity={n.kind === "uncertain" ? 0.08 : n.kind === "interpreted" ? 0.28 : 0.14}
            className={`sp-web ${n.order >= mobileVisibleCount ? "hidden sm:block" : ""}`}
            style={{ ["--sp-delay" as string]: `${n.delayMs}ms` }}
          />
        ))}
        {/* Semantic webbing between related traits — real relationships only. */}
        {edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const eitherHidden = a.order >= mobileVisibleCount || b.order >= mobileVisibleCount;
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={`${a.x}%`}
              y1={`${a.y}%`}
              x2={`${b.x}%`}
              y2={`${b.y}%`}
              stroke="url(#web-grad)"
              strokeWidth={0.4 + e.strength * 1.3}
              opacity={0.18 + e.strength * 0.42}
              className={`sp-web ${eitherHidden ? "hidden sm:block" : ""}`}
              style={{ ["--sp-delay" as string]: `${Math.max(a.delayMs, b.delayMs)}ms` }}
            />
          );
        })}
      </svg>

      {positioned.map((n) => {
        const href = onNodeClick?.(n.id) ?? null;
        const Tag = href ? "a" : "div";
        return (
          <Tag
            key={n.id}
            {...(href ? { href } : {})}
            className={`sp-node pointer-events-auto absolute max-w-[168px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border px-2.5 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-transform hover:z-20 hover:scale-[1.04] ${
              n.order >= mobileVisibleCount ? "hidden sm:block" : ""
            } ${KIND_STYLE[n.kind]} ${n.kind === "interpreted" ? "text-[12.5px]" : "text-[11px]"}`}
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              ["--sp-delay" as string]: `${n.delayMs}ms`,
            }}
            title={n.detail ?? n.label}
          >
            <div className="mb-0.5 flex items-center gap-1.5">
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${
                  n.kind === "interpreted"
                    ? "bg-fuchsia"
                    : n.kind === "comparative"
                      ? "bg-cobalt"
                      : n.kind === "uncertain"
                        ? "bg-ink-4"
                        : "bg-ink-3"
                }`}
              />
              <span className="eyebrow !text-[8.5px] !tracking-[0.08em]">{KIND_LABEL[n.kind]}</span>
              {n.percentile !== null && n.percentile !== undefined && (
                <span className="tnum ml-auto shrink-0 text-[9.5px] text-info">
                  {n.percentile}
                  <sup>th</sup>
                </span>
              )}
            </div>
            <p className="leading-snug line-clamp-3">{n.label}</p>
          </Tag>
        );
      })}
    </div>
  );
}
