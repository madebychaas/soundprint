/**
 * Reference upload.
 *
 * Writes the audio to local storage, creates the row, and launches the
 * pipeline as a detached task so the response returns immediately. The client
 * then polls status — which is what makes the "analysis state" visible in the
 * project view rather than the page simply hanging.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { AUDIO_DIR, db, schema } from "@/lib/db";
import { startPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set([
  ".mp3", ".wav", ".wave", ".flac", ".m4a", ".mp4", ".aac",
  ".ogg", ".oga", ".opus", ".aiff", ".aif", ".aifc", ".alac", ".caf",
]);

/** Strip directory components and anything that could escape the audio dir. */
function safeExtension(filename: string): string | null {
  const ext = path.extname(path.basename(filename)).toLowerCase();
  return ALLOWED.has(ext) ? ext : null;
}

function titleFromFilename(filename: string): string {
  return (
    path
      .basename(filename, path.extname(filename))
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled reference"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No audio files were provided." }, { status: 400 });
  }

  const created: { id: string; title: string }[] = [];
  const rejected: { filename: string; reason: string }[] = [];

  for (const file of files) {
    const ext = safeExtension(file.name);
    if (!ext) {
      rejected.push({
        filename: file.name,
        reason: `Unsupported format. Supported: ${[...ALLOWED].map((e) => e.slice(1)).join(", ")}.`,
      });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ filename: file.name, reason: "File is empty." });
      continue;
    }
    if (file.size > MAX_BYTES) {
      rejected.push({
        filename: file.name,
        reason: `File is ${(file.size / 1e6).toFixed(0)} MB; the limit is ${MAX_BYTES / 1e6} MB.`,
      });
      continue;
    }

    const referenceId = randomUUID();
    const storageKey = `${referenceId}${ext}`;

    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      await fs.mkdir(AUDIO_DIR, { recursive: true });
      await fs.writeFile(path.join(AUDIO_DIR, storageKey), bytes);
    } catch (err) {
      rejected.push({
        filename: file.name,
        reason: `Could not save file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const title = (form.get("title") as string)?.trim() || titleFromFilename(file.name);
    const artist = (form.get("artist") as string)?.trim() || null;

    db.insert(schema.references)
      .values({
        id: referenceId,
        projectId,
        title: files.length > 1 ? titleFromFilename(file.name) : title,
        artist,
        sourceFilename: file.name,
        storageBackend: "local",
        storageKey,
        fileSizeBytes: file.size,
        status: "uploaded",
      })
      .run();

    created.push({ id: referenceId, title });
    startPipeline(referenceId);
  }

  db.update(schema.projects)
    .set({ updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.projects.id, projectId))
    .run();

  if (created.length === 0) {
    return NextResponse.json(
      { error: "No files could be accepted.", rejected },
      { status: 400 },
    );
  }

  return NextResponse.json({ created, rejected }, { status: 201 });
}
