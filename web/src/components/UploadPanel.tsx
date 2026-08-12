"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif,audio/*";

export function UploadPanel({ projectId }: { projectId: string }) {
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
      } else {
        setRejected(data.rejected ?? []);
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
    <div className="rounded border border-line bg-surface p-5">
      <div className="eyebrow mb-3">Add references</div>

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
        className={`cursor-pointer rounded border border-dashed px-4 py-10 text-center transition-colors ${
          dragging ? "border-signal bg-signal-wash" : "border-line hover:border-line-bright"
        }`}
      >
        <p className="text-[13px] text-ink-2">
          {busy ? "Uploading…" : "Drop audio here, or click to choose"}
        </p>
        <p className="mt-1.5 text-[11px] text-ink-4">
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

      {error && <p className="mt-3 text-[12px] text-bad">{error}</p>}

      {rejected.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rejected.map((r) => (
            <li key={r.filename} className="text-[11px] leading-relaxed text-warn">
              <span className="font-medium">{r.filename}</span> — {r.reason}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-ink-4">
        Files are stored on this machine only. Analysis runs locally; if an AI provider is
        configured, only the resulting measurements are sent for interpretation.
      </p>
    </div>
  );
}
