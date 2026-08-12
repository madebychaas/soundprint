"use client";

/**
 * Capability indicator.
 *
 * Surfaces the two things that can silently break the product — the analysis
 * service being down and interpretation falling back to rules — before the
 * user has invested effort in an upload.
 */

import { useEffect, useState } from "react";

interface Health {
  audioService: { reachable: boolean; analyzer_version?: string; transcoder?: string | null; hint?: string };
  appDatabase?: { reachable: boolean; detail?: string };
  baseline?: {
    reachable: boolean;
    baselineVersion?: string | null;
    observedTracks?: number;
    datasets?: { id: string; evidenceClass: string; records: number }[];
    weightingPolicy?: { maxSourceShare: number; minSupportN: number } | null;
    detail?: string;
  };
  interpretation: {
    active: { id: string; label: string } | null;
    providers: { id: string; label: string; available: boolean; reason?: string }[];
  };
}

export function SystemStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((d) => alive && setHealth(d))
        .catch(() => alive && setHealth(null));
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!health) {
    return <span className="text-[11px] text-ink-4">checking…</span>;
  }

  const audioOk = health.audioService.reachable;
  const heuristic = health.interpretation.active?.id === "heuristic";
  const baselineOk = health.baseline?.reachable ?? false;
  // The baseline is an enhancement, not a dependency: its absence is worth
  // surfacing but must never read as a broken installation.
  const tone = !audioOk ? "bad" : heuristic ? "warn" : "good";
  const dot = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {!audioOk ? "Analyzer offline" : heuristic ? "No AI provider" : "Ready"}
        {audioOk && !baselineOk && (
          <span className="text-ink-4" title="World baseline not installed">· no baseline</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] rounded border border-line bg-surface p-4 shadow-2xl">
          <div className="eyebrow mb-2">Audio analysis</div>
          {audioOk ? (
            <p className="text-[12px] text-ink-2">
              Running — analyzer v{health.audioService.analyzer_version}
              {health.audioService.transcoder ? ` · ${health.audioService.transcoder} available` : ""}
            </p>
          ) : (
            <div className="text-[12px] text-bad">
              <p>Not reachable. Uploads will fail until it is running.</p>
              {health.audioService.hint && (
                <code className="mt-2 block rounded bg-surface-2 p-2 text-[10.5px] leading-relaxed text-ink-3">
                  {health.audioService.hint}
                </code>
              )}
            </div>
          )}

          <div className="eyebrow mb-2 mt-4">World baseline</div>
          {baselineOk ? (
            <div className="text-[12px] text-ink-2">
              <p>
                {health.baseline?.baselineVersion} —{" "}
                <span className="tnum">
                  {(health.baseline?.observedTracks ?? 0).toLocaleString()}
                </span>{" "}
                observed tracks
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {health.baseline?.datasets?.map((d) => (
                  <li key={d.id} className="flex items-baseline gap-2 text-[11px]">
                    <span
                      className={
                        d.evidenceClass === "synthetic" ? "text-warn" : "text-ink-3"
                      }
                    >
                      {d.id}
                    </span>
                    <span className="tnum text-ink-4">{d.records.toLocaleString()}</span>
                    {d.evidenceClass === "synthetic" && (
                      <span
                        className="text-[9.5px] uppercase tracking-wide text-warn"
                        title="Excluded from factual comparative claims"
                      >
                        synthetic
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {health.baseline?.weightingPolicy && (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-4">
                  Source-capped at {Math.round(health.baseline.weightingPolicy.maxSourceShare * 100)}%
                  ; comparative claims need {health.baseline.weightingPolicy.minSupportN}+ observations.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-4">
              Not installed. Everything works; Soundprint just cannot say whether a
              characteristic is unusual.
            </p>
          )}

          <div className="eyebrow mb-2 mt-4">Interpretation</div>
          <p className="mb-2 text-[12px] text-ink-2">
            Active: <span className="text-ink">{health.interpretation.active?.label ?? "none"}</span>
          </p>
          {heuristic && (
            <p className="mb-2 rounded border border-warn/30 bg-warn/5 p-2 text-[11px] leading-relaxed text-warn">
              No language model is configured, so Sound DNA is generated by built-in rules.
              It works, but the interpretive layer is much thinner. Set ANTHROPIC_API_KEY, or
              install the Claude CLI, for a fuller reading.
            </p>
          )}
          <ul className="space-y-1">
            {health.interpretation.providers.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-[11px]">
                <span
                  className={`mt-1 h-1 w-1 shrink-0 rounded-full ${p.available ? "bg-good" : "bg-ink-4"}`}
                />
                <span className={p.available ? "text-ink-2" : "text-ink-4"}>
                  {p.label}
                  {!p.available && p.reason ? ` — ${p.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
