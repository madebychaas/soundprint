import Link from "next/link";
import { notFound } from "next/navigation";

import { PromptStudio } from "@/components/PromptStudio";
import { LiveStatusBanner } from "@/components/spatial/LiveStatusBanner";
import { loadReference } from "@/lib/pipeline";
import { loadTasteProfile } from "@/lib/taste/engine";

export const dynamic = "force-dynamic";

const WORKING = new Set(["uploaded", "analyzing", "interpreting"]);

export default async function ReferencePromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = loadReference(id);
  if (!loaded) notFound();

  if (!loaded.dna) {
    const working = WORKING.has(loaded.reference.status);

    // Still generating: show the real status and let LiveStatusBanner's
    // polling do the same job it does on the reference page — refresh this
    // server component's data (not the document) the moment status changes,
    // so Prompt Studio appears the instant DNA actually exists. No DNA is
    // fabricated to get there sooner.
    if (working) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <LiveStatusBanner
            referenceId={id}
            status={loaded.reference.status}
            detail={loaded.reference.statusDetail}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            Prompt Studio opens automatically once this Soundprint&rsquo;s DNA forms.
          </p>
          <Link
            href={`/references/${id}`}
            className="mt-4 inline-block text-[12.5px] text-signal hover:underline"
          >
            Watch it resolve
          </Link>
        </div>
      );
    }

    // Not working and still no DNA: analysis failed, or interpretation
    // never produced one. A different message from "still generating" —
    // this state will not resolve itself, so it gets no live poller.
    return (
      <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center">
        <p className="text-[13px] text-ink-2">
          {loaded.reference.status === "failed"
            ? "Analysis failed, so no Sound DNA exists for this reference."
            : "This reference has no Sound DNA yet."}
        </p>
        <Link
          href={`/references/${id}`}
          className="mt-3 inline-block text-[12.5px] text-signal hover:underline"
        >
          Back to the reference
        </Link>
      </div>
    );
  }

  const taste = loadTasteProfile();

  return (
    <div>
      <Link href={`/references/${id}`} className="text-[12px] text-ink-3 hover:text-ink-2">
        ← {loaded.reference.title}
      </Link>
      <div className="mt-1.5">
        <PromptStudio
          referenceId={id}
          title="Prompt Studio"
          subtitle={`Generating from one reference. Adjust the modifiers to steer away from it while keeping its DNA.`}
          hasTasteProfile={taste.traits.length > 0}
        />
      </div>
    </div>
  );
}
