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
 * Layout: a wide horizontal field on desktop — object beside the copy, not
 * above it in a narrow centered column — because this is the first thing on
 * the page and it should read as a spatial field using the width it has, not
 * a SaaS landing hero. On mobile it stacks: object, heading, an explicit
 * "choose a file" affordance (touch has no drag gesture, so the tap target
 * needs its own line), then the format line.
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
    <div className="relative">
      {/* Ambient wash spanning the full field — the width the composition
          "occupies" is light and material, not literal control width. Keeps
          the right side of a wide viewport from reading as accidental empty
          space while the actual controls stay left-anchored and legible. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-6 inset-y-0 -z-10 hidden sm:block"
        style={{
          background:
            "radial-gradient(ellipse 60% 95% at 10% 45%, rgba(239,79,176,0.16), transparent 65%), " +
            "radial-gradient(ellipse 65% 80% at 55% 35%, rgba(139,92,246,0.11), transparent 70%), " +
            "radial-gradient(ellipse 50% 70% at 88% 60%, rgba(79,123,255,0.09), transparent 72%)",
        }}
      />

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
        className={`group relative flex w-full cursor-pointer flex-col items-center gap-5 rounded-[2rem] py-8 text-center outline-none transition-[filter] sm:flex-row sm:items-center sm:gap-10 sm:py-12 sm:text-left lg:gap-14 lg:py-16 ${
          dragging ? "brightness-125" : ""
        }`}
      >
        <div
          className={`shrink-0 ${dragging ? "scale-105" : ""} transition-transform`}
          style={{
            background: "radial-gradient(circle, rgba(239,79,176,0.14), transparent 70%)",
          }}
        >
          <LiquidObject
            seed={defaultProjectId ?? "home"}
            knowledge={busy ? 0.6 : 0.15}
            active={busy || dragging}
            className="h-[130px] w-[130px] sm:h-[180px] sm:w-[180px] md:h-[210px] md:w-[210px] lg:h-[240px] lg:w-[240px] xl:h-[260px] xl:w-[260px]"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-2.5 sm:items-start">
          <h1 className="text-[28px] font-semibold leading-none tracking-tight text-ink sm:text-[36px] md:text-[42px] lg:text-[52px] xl:text-[58px]">
            {busy ? "Listening…" : "Drop a sound"}
          </h1>
          <p className="text-[14px] text-ink-3 sm:text-[16px] lg:text-[19px]">
            {busy ? "Measuring what makes it distinctive" : "Choose a file, or drop one anywhere here."}
          </p>

          {!busy && (
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line-bright/60 bg-surface-2/80 px-3 py-1.5 text-[12px] text-ink-2 sm:hidden">
              Choose a file
            </span>
          )}

          <p className="mt-1 text-[10.5px] text-ink-4 lg:text-[11.5px]">
            mp3 · wav · flac · m4a · aiff · ogg — up to 100 MB
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => e.target.files && void upload(e.target.files)}
      />

      {error && <p className="mt-3 text-center text-[12px] text-bad sm:text-left">{error}</p>}
    </div>
  );
}
