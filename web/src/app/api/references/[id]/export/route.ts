/** Sound DNA and raw-analysis downloads. */

import { NextResponse } from "next/server";

import { loadReference } from "@/lib/pipeline";

export const runtime = "nodejs";

function safeFilename(title: string, suffix: string): string {
  const base =
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .toLowerCase() || "soundprint";
  return `${base}-${suffix}.json`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "json";

  const loaded = loadReference(id);
  if (!loaded) return NextResponse.json({ error: "Reference not found." }, { status: 404 });

  if (format === "analysis") {
    if (!loaded.analysis) {
      return NextResponse.json({ error: "No analysis available yet." }, { status: 409 });
    }
    return download(loaded.analysis, safeFilename(loaded.reference.title, "analysis"));
  }

  if (!loaded.dna) {
    return NextResponse.json({ error: "No Sound DNA available yet." }, { status: 409 });
  }

  const payload = {
    sound_dna: loaded.dna,
    provenance: loaded.provenance,
    generation_notes: loaded.dnaIssues,
    source: {
      title: loaded.reference.title,
      artist: loaded.reference.artist,
      filename: loaded.reference.sourceFilename,
      duration_seconds: loaded.reference.durationSeconds,
    },
    user_notes: loaded.notes.map((n) => n.body),
    rating: loaded.rating,
    disclaimer:
      "Describes musical characteristics for creating original work. Not a reproduction of the source recording, melody, lyrics or artist identity.",
  };

  return download(payload, safeFilename(loaded.reference.title, "sound-dna"));
}

function download(payload: unknown, filename: string) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
