"use client";

/**
 * Prompt Studio.
 *
 * Modifiers are expressed as deviations *from* the DNA rather than as
 * replacements for it, which is what makes "use my sound profile, but make this
 * one euphoric" work: the preserved characteristics stay in the prompt and the
 * modifier is added as an explicit instruction to depart from them.
 */

import { useCallback, useEffect, useState } from "react";

import { PROMPT_KINDS, type Modifiers, type PromptKind } from "@/lib/prompts/renderers";

interface Props {
  referenceId?: string;
  projectId?: string;
  title: string;
  subtitle: string;
  hasTasteProfile: boolean;
}

const SLIDERS: { key: keyof Modifiers; left: string; right: string; label: string }[] = [
  { key: "mood", left: "Darker", right: "Brighter", label: "Mood" },
  { key: "energy", left: "Restrained", right: "Explosive", label: "Energy" },
  { key: "organicElectronic", left: "Organic", right: "Electronic", label: "Palette" },
  { key: "density", left: "Minimal", right: "Dense", label: "Density" },
  { key: "scale", left: "Intimate", right: "Epic", label: "Scale" },
];

export function PromptStudio({ referenceId, projectId, title, subtitle, hasTasteProfile }: Props) {
  const [kind, setKind] = useState<PromptKind>("generic");
  const [modifiers, setModifiers] = useState<Modifiers>({
    mood: 0,
    energy: 0,
    organicElectronic: 0,
    density: 0,
    scale: 0,
    tempo: { mode: "same" },
    dnaStrength: 1,
  });
  const [direction, setDirection] = useState("");
  const [includeTaste, setIncludeTaste] = useState(false);
  const [result, setResult] = useState<{ body: string; caveats: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          referenceId,
          projectId,
          includeTasteProfile: includeTaste,
          modifiers: { ...modifiers, direction: direction.trim() || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate the prompt.");
      setResult(data.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [kind, referenceId, projectId, modifiers, direction, includeTaste]);

  // Re-render on any change; generation is a pure local transform, so this is
  // cheap and keeps the output honest to the controls.
  useEffect(() => {
    const t = setTimeout(() => void generate(), 180);
    return () => clearTimeout(t);
  }, [generate]);

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const set = (key: keyof Modifiers, value: number) =>
    setModifiers((m) => ({ ...m, [key]: value }));

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-5">
          <div className="rounded border border-line bg-surface p-4">
            <div className="eyebrow mb-3">Format</div>
            <div className="space-y-1">
              {PROMPT_KINDS.map((k) => (
                <button
                  key={k.kind}
                  onClick={() => setKind(k.kind)}
                  className={`block w-full rounded px-3 py-2 text-left transition-colors ${
                    kind === k.kind ? "bg-signal-wash text-signal" : "text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  <div className="text-[13px] font-medium">{k.label}</div>
                  <div className="text-[11px] text-ink-4">{k.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded border border-line bg-surface p-4">
            <div className="eyebrow mb-4">Modifiers</div>

            {SLIDERS.map((s) => (
              <div key={String(s.key)} className="mb-4">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-ink-4">{s.left}</span>
                  <span className="text-ink-3">{s.label}</span>
                  <span className="text-ink-4">{s.right}</span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.25}
                  value={(modifiers[s.key] as number) ?? 0}
                  onChange={(e) => set(s.key, Number(e.target.value))}
                  className="w-full"
                />
              </div>
            ))}

            <div className="mb-4">
              <div className="mb-1.5 text-[11px] text-ink-3">Tempo</div>
              <div className="flex gap-1">
                {(["slower", "same", "faster", "explicit"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() =>
                      setModifiers((m) => ({
                        ...m,
                        tempo: { mode, bpm: m.tempo?.bpm ?? 120 },
                      }))
                    }
                    className={`flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors ${
                      modifiers.tempo?.mode === mode
                        ? "border-signal text-signal"
                        : "border-line text-ink-3 hover:border-line-bright"
                    }`}
                  >
                    {mode === "explicit" ? "BPM" : mode}
                  </button>
                ))}
              </div>
              {modifiers.tempo?.mode === "explicit" && (
                <input
                  type="number"
                  min={40}
                  max={220}
                  value={modifiers.tempo.bpm ?? 120}
                  onChange={(e) =>
                    setModifiers((m) => ({
                      ...m,
                      tempo: { mode: "explicit", bpm: Number(e.target.value) },
                    }))
                  }
                  className="tnum mt-2 w-full rounded border border-line bg-surface-2 px-2 py-1.5 text-[12.5px]"
                />
              )}
            </div>

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-ink-3">DNA strength</span>
                <span className="tnum text-ink-4">
                  {Math.round((modifiers.dnaStrength ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={modifiers.dnaStrength ?? 1}
                onChange={(e) => set("dnaStrength", Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-4">
                Below 100%, the prompt says to treat the DNA as an influence rather than a
                specification.
              </p>
            </div>

            <label className="block">
              <span className="text-[11px] text-ink-3">Push it somewhere</span>
              <input
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder="toward cinematic soul"
                className="mt-1.5 w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] placeholder:text-ink-4"
              />
            </label>

            {hasTasteProfile && (
              <label className="mt-4 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={includeTaste}
                  onChange={(e) => setIncludeTaste(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-signal)]"
                />
                <span className="text-[11.5px] leading-relaxed text-ink-2">
                  Fold in my Taste Profile tendencies
                </span>
              </label>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="rounded border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="eyebrow">{busy ? "Rendering…" : "Prompt"}</span>
              <button
                onClick={() => void copy()}
                disabled={!result}
                className="rounded border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            {error ? (
              <p className="px-4 py-6 text-[13px] text-bad">{error}</p>
            ) : (
              <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap px-4 py-4 text-[12.5px] leading-relaxed text-ink">
                {result?.body ?? ""}
              </pre>
            )}
          </div>

          {result?.caveats && result.caveats.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {result.caveats.map((c, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-ink-4">
                  · {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
