"use client";

/**
 * The Intake object.
 *
 * Visual replacement for UploadPanel. Same upload logic, same API contract —
 * `POST /api/projects/:id/references` with a FormData `files` list — nothing
 * about how upload works changed, only how it looks and what happens after a
 * single drop.
 *
 * A single-file drop routes straight to that reference's page, so the user
 * lands in INTAKE → ANALYSIS immediately instead of back on a list. A
 * multi-file drop stays here (there is no one place to land) and refreshes
 * the list below, same as before.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { LiquidObject } from "./LiquidObject";

const ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,audio/*";

export function IntakeField({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ filename: string; reason: string }[]>([]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    setRejected([]);

    const form = new FormData();
    for (const f of list) form.append("files", f);

    try {
      const res = await fetch(`/api/projects/${projectId}/references`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        setRejected(data.rejected ?? []);
        return;
      }
      setRejected(data.rejected ?? []);
      if (data.created?.length === 1) {
        router.push(`/references/${data.created[0].id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="sp-field relative">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop a sound here, or choose a file"
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-[2.5rem] py-12 text-center outline-none transition-[filter] ${
          dragging ? "brightness-125" : ""
        }`}
      >
        <div className={dragging ? "scale-105 transition-transform" : "transition-transform"}>
          <LiquidObject seed={projectId} size={200} knowledge={busy ? 0.6 : 0.15} active={busy || dragging} />
        </div>

        <p className="mt-6 text-[15px] font-medium tracking-tight text-ink">
          {busy ? "Listening…" : "Drop a sound here"}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">
          {busy ? "Measuring what makes it distinctive" : "or click to choose a file"}
        </p>
        <p className="mt-3 text-[10.5px] text-ink-4">
          mp3 · wav · flac · m4a · aiff · ogg — up to 100 MB each
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => e.target.files && void upload(e.target.files)}
      />

      {error && <p className="mt-3 text-center text-[12px] text-bad">{error}</p>}

      {rejected.length > 0 && (
        <ul className="mx-auto mt-3 max-w-sm space-y-1.5">
          {rejected.map((r) => (
            <li key={r.filename} className="text-[11px] leading-relaxed text-warn">
              <span className="font-medium">{r.filename}</span> — {r.reason}
            </li>
          ))}
        </ul>
      )}

      <p className="mx-auto mt-4 max-w-xs text-center text-[10.5px] leading-relaxed text-ink-4">
        Files are stored on this machine only. Analysis runs locally; if an AI provider is
        configured, only the resulting measurements are sent for interpretation.
      </p>
    </div>
  );
}
