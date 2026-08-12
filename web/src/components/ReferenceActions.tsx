"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReferenceActions({
  referenceId,
  projectId,
}: {
  referenceId: string;
  projectId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function act(action: "reanalyze" | "reinterpret") {
    setBusy(true);
    try {
      await fetch(`/api/references/${referenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/references/${referenceId}`, { method: "DELETE" });
      router.push(`/projects/${projectId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => void act("reinterpret")}
        disabled={busy}
        title="Re-run interpretation only (keeps the measured analysis)"
        className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink disabled:opacity-40"
      >
        Regenerate DNA
      </button>
      <button
        onClick={() => void act("reanalyze")}
        disabled={busy}
        title="Re-measure the audio from scratch"
        className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-line-bright hover:text-ink disabled:opacity-40"
      >
        Re-analyse
      </button>

      {confirming ? (
        <span className="flex items-center gap-1.5">
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="rounded border border-bad/50 bg-bad/10 px-2.5 py-1.5 text-[12px] text-bad"
          >
            Delete permanently
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded px-2 py-1.5 text-[12px] text-ink-4 hover:text-ink-2"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded border border-line px-2.5 py-1.5 text-[12px] text-ink-4 transition-colors hover:border-bad/50 hover:text-bad"
        >
          Delete
        </button>
      )}
    </div>
  );
}
