"use client";

/**
 * The home-page intake object.
 *
 * Every reference belongs to a project (that contract does not change here),
 * but a first-time visitor should not have to understand projects before
 * they can drop a file. So this drops straight into the most recently used
 * project when one exists, and silently creates a first one — via the same
 * `POST /api/projects` NewProjectForm already uses — when it doesn't. Either
 * way it's the same two existing endpoints already in the API surface, called
 * in sequence; nothing new was added to the backend for this.
 *
 * Upload affordance comes before understanding: this is meant to be the
 * first thing on the page, above the fold, with no dashed SaaS dropzone —
 * the same liquid-chrome object used everywhere else in the intake→analysis
 * journey, so it reads as *the* way in rather than a decorative header.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { LiquidObject } from "./LiquidObject";

const ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,audio/*";

export function QuickIntakeField({ defaultProjectId }: { defaultProjectId: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolveProjectId(): Promise<string> {
    if (defaultProjectId) return defaultProjectId;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My sounds" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not start a project for this upload.");
    return data.project.id as string;
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0 || busy) return;

    setBusy(true);
    setError(null);

    try {
      const projectId = await resolveProjectId();

      const form = new FormData();
      for (const f of list) form.append("files", f);

      const res = await fetch(`/api/projects/${projectId}/references`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      if (data.created?.length === 1) {
        router.push(`/references/${data.created[0].id}`);
      } else {
        router.push(`/projects/${projectId}`);
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
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-[2.5rem] py-10 text-center outline-none transition-[filter] ${
          dragging ? "brightness-125" : ""
        }`}
      >
        <div className={dragging ? "scale-105 transition-transform" : "transition-transform"}>
          <LiquidObject seed={defaultProjectId ?? "home"} size={180} knowledge={busy ? 0.6 : 0.15} active={busy || dragging} />
        </div>

        <p className="mt-5 text-[20px] font-semibold tracking-tight text-ink">
          {busy ? "Listening…" : "Drop a sound"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3">
          {busy ? "Measuring what makes it distinctive" : "or choose a file to start its Soundprint"}
        </p>
        <p className="mt-3 text-[10.5px] text-ink-4">
          mp3 · wav · flac · m4a · aiff · ogg — up to 100 MB
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
    </div>
  );
}
