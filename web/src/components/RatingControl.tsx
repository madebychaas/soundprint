"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const OPTIONS = [
  { value: "love", label: "Love", short: "♥" },
  { value: "like", label: "Like", short: "+" },
  { value: "neutral", label: "Neutral", short: "·" },
  { value: "not_for_me", label: "Not for me", short: "−" },
] as const;

export function RatingControl({
  referenceId,
  initial,
  compact = false,
}: {
  referenceId: string;
  initial: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function set(value: string) {
    if (busy) return;
    setBusy(true);
    const previous = rating;
    setRating(value); // optimistic
    try {
      const res = await fetch(`/api/references/${referenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setRating(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {OPTIONS.map((o) => {
        const on = rating === o.value;
        return (
          <button
            key={o.value}
            title={o.label}
            onClick={() => void set(o.value)}
            disabled={busy}
            className={`rounded border px-1.5 py-1 text-[11px] leading-none transition-colors ${
              on
                ? "border-signal bg-signal-wash text-signal"
                : "border-transparent text-ink-4 hover:border-line hover:text-ink-2"
            } ${busy ? "opacity-50" : ""}`}
          >
            {compact ? o.short : o.label}
          </button>
        );
      })}
    </div>
  );
}
