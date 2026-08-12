/** Reference status polling, mutation and deletion. */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, resolveAudioPath, schema } from "@/lib/db";
import { isRunning, loadReference, startPipeline } from "@/lib/pipeline";
import { recomputeTasteProfile } from "@/lib/taste/engine";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = loadReference(id);
  if (!loaded) return NextResponse.json({ error: "Reference not found." }, { status: 404 });

  return NextResponse.json({
    id: loaded.reference.id,
    title: loaded.reference.title,
    status: loaded.reference.status,
    statusDetail: loaded.reference.statusDetail,
    error: loaded.reference.errorMessage,
    running: isRunning(id),
    hasAnalysis: loaded.analysis !== null,
    hasDna: loaded.dna !== null,
    rating: loaded.rating,
    warnings: loaded.analysis?.warnings ?? [],
    provider: loaded.provenance?.provider ?? null,
    heuristic: loaded.provenance?.heuristic ?? null,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reference = db
    .select()
    .from(schema.references)
    .where(eq(schema.references.id, id))
    .get();
  if (!reference) return NextResponse.json({ error: "Reference not found." }, { status: 404 });

  let body: {
    title?: string;
    artist?: string | null;
    rating?: schema.Rating;
    note?: string;
    action?: "reanalyze" | "reinterpret";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Partial<typeof schema.references.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (body.artist !== undefined) patch.artist = body.artist?.trim() ? body.artist.trim().slice(0, 200) : null;
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = Math.floor(Date.now() / 1000);
    db.update(schema.references).set(patch).where(eq(schema.references.id, id)).run();
  }

  if (body.rating) {
    const valid: schema.Rating[] = ["love", "like", "neutral", "not_for_me"];
    if (!valid.includes(body.rating)) {
      return NextResponse.json({ error: `Invalid rating. Expected one of: ${valid.join(", ")}` }, { status: 400 });
    }
    db.insert(schema.ratings)
      .values({ referenceId: id, rating: body.rating })
      .onConflictDoUpdate({
        target: schema.ratings.referenceId,
        set: { rating: body.rating, updatedAt: Math.floor(Date.now() / 1000) },
      })
      .run();
    await recomputeTasteProfile();
  }

  if (typeof body.note === "string" && body.note.trim()) {
    db.insert(schema.notes)
      .values({ id: randomUUID(), referenceId: id, body: body.note.trim().slice(0, 2000) })
      .run();
  }

  if (body.action === "reanalyze") {
    startPipeline(id, { forceReanalyze: true });
  } else if (body.action === "reinterpret") {
    startPipeline(id, { forceReinterpret: true });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reference = db
    .select()
    .from(schema.references)
    .where(eq(schema.references.id, id))
    .get();
  if (!reference) return NextResponse.json({ error: "Reference not found." }, { status: 404 });

  // Remove the audio first: an orphaned row is recoverable, an orphaned
  // multi-megabyte file on disk is invisible and never cleaned up.
  try {
    await fs.unlink(resolveAudioPath(reference.storageKey, reference.storageBackend));
  } catch {
    /* already gone — deletion is still correct */
  }

  db.delete(schema.references).where(eq(schema.references.id, id)).run();
  await recomputeTasteProfile();
  return NextResponse.json({ ok: true });
}
