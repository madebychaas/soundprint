import Link from "next/link";
import { notFound } from "next/navigation";

import { PromptStudio } from "@/components/PromptStudio";
import { loadReference } from "@/lib/pipeline";
import { loadTasteProfile } from "@/lib/taste/engine";

export const dynamic = "force-dynamic";

export default async function ReferencePromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = loadReference(id);
  if (!loaded) notFound();

  if (!loaded.dna) {
    return (
      <div className="rounded border border-line bg-surface px-6 py-12 text-center">
        <p className="text-[13px] text-ink-2">This reference has no Sound DNA yet.</p>
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
