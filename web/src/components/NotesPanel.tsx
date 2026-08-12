"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NotesPanel({
  referenceId,
  notes,
}: {
  referenceId: string;
  notes: { id: string; body: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/references/${referenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/references/${referenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reinterpret" }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-line bg-surface p-4">
      <div className="eyebrow mb-1">Your notes</div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-4">
        What you say about this track outranks anything the analysis infers. Add a note, then
        regenerate to fold it into the interpretation.
      </p>

      {notes.length > 0 && (
        <ul className="mb-3 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded border-l-2 border-signal-dim bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2"
            >
              {n.body}
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="The transition at 1:07 is what I want. I don't care about the vocal."
        className="w-full resize-none rounded border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed placeholder:text-ink-4"
      />

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void add()}
          disabled={!text.trim() || busy}
          className="flex-1 rounded border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink disabled:opacity-40"
        >
          Add note
        </button>
        {notes.length > 0 && (
          <button
            onClick={() => void regenerate()}
            disabled={busy}
            title="Re-run interpretation with your notes included"
            className="rounded border border-signal-dim px-3 py-1.5 text-[12.5px] text-signal transition-colors hover:bg-signal-wash disabled:opacity-40"
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}
