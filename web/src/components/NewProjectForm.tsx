"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the project.");
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded border border-line bg-surface p-5">
      <div className="eyebrow mb-3">New project</div>

      <label className="block">
        <span className="text-[12px] text-ink-2">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dark pop references"
          maxLength={120}
          className="mt-1.5 w-full rounded border border-line bg-surface-2 px-3 py-2 text-[13px] placeholder:text-ink-4"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[12px] text-ink-2">
          What are you looking for? <span className="text-ink-4">(optional)</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Restrained verses, huge choruses, sub-heavy"
          className="mt-1.5 w-full resize-none rounded border border-line bg-surface-2 px-3 py-2 text-[13px] placeholder:text-ink-4"
        />
      </label>

      {error && <p className="mt-3 text-[12px] text-bad">{error}</p>}

      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="mt-4 w-full rounded bg-signal px-3 py-2 text-[13px] font-medium text-[#14100a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-4"
      >
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
