"use client";

/**
 * Live status while a reference is working, without reloading the document.
 *
 * Pass 2A's original mechanism here was a server component returning
 * `<meta http-equiv="refresh" content="4">` — a genuine full browser
 * navigation every 4 seconds for as long as the reference sat in
 * uploaded/analyzing/interpreting. That is not a dev-mode artifact; it is a
 * literal document reload and behaves identically in a production build. It
 * was tolerable against the old static panel UI; against a breathing object
 * with entrance-animated discoveries it reads as the page constantly
 * reloading, because it is.
 *
 * This replaces it with the same polling shape `ReferenceList` already uses
 * elsewhere in the app: a short client-side interval hits the existing
 * `GET /api/references/:id` status endpoint, and only calls `router.refresh()`
 * — a React Server Component data refresh, not a navigation — when the
 * status actually changes. No new endpoint, no pipeline change. The interval
 * is cleared the moment the component unmounts, which happens automatically
 * once the page re-renders with a settled status, so there is nothing left
 * running once analysis completes.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const ACTIVE = new Set(["uploaded", "analyzing", "interpreting"]);

export function LiveStatusBanner({
  referenceId,
  status,
  detail,
}: {
  referenceId: string;
  status: string;
  detail: string | null;
}) {
  const router = useRouter();
  const lastStatus = useRef(status);

  useEffect(() => {
    lastStatus.current = status;
    if (!ACTIVE.has(status)) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/references/${referenceId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { status: string } = await res.json();
        if (data.status !== lastStatus.current) {
          lastStatus.current = data.status;
          router.refresh();
        }
      } catch {
        // Transient network hiccup — the next tick tries again. A missed
        // status update is invisible; a thrown error here is not worth one.
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, referenceId, router]);

  return (
    <div className="mb-2 flex items-center justify-center gap-3 py-2 text-center">
      <span className="h-1.5 w-1.5 animate-working rounded-full bg-signal" />
      <div>
        <div className="text-[13px] font-medium">{detail ?? "Working…"}</div>
        <p className="mt-0.5 text-[11.5px] text-ink-4">
          Measurement takes roughly 20-40 seconds for a full-length track. This updates live.
        </p>
      </div>
    </div>
  );
}
