/**
 * Prompt rendering.
 *
 * Accepts either a single reference or a whole project. For a project, shared
 * traits from the comparison engine are folded in so the prompt describes what
 * persists across the set rather than one arbitrary member of it.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { compareReferences } from "@/lib/comparison/engine";
import { db, schema } from "@/lib/db";
import type { SoundDna } from "@/lib/dna/schema";
import { loadProjectReferences, loadReference } from "@/lib/pipeline";
import {
  type Modifiers,
  PROMPT_KINDS,
  type PromptKind,
  type RenderContext,
  renderPrompt,
} from "@/lib/prompts/renderers";
import { loadTasteProfile } from "@/lib/taste/engine";

export const runtime = "nodejs";

const VALID_KINDS = new Set(PROMPT_KINDS.map((k) => k.kind));

export async function POST(request: Request) {
  let body: {
    kind?: PromptKind;
    referenceId?: string;
    projectId?: string;
    modifiers?: Modifiers;
    includeTasteProfile?: boolean;
    save?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const kind = body.kind ?? "generic";
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `Unknown prompt kind. Expected one of: ${[...VALID_KINDS].join(", ")}` },
      { status: 400 },
    );
  }

  let dna: SoundDna | null = null;
  let sourceTitle: string | null = null;
  let sourceArtist: string | null = null;
  let sharedTraits: string[] | undefined;
  let measuredTiming: RenderContext["measuredTiming"];

  if (body.referenceId) {
    const loaded = loadReference(body.referenceId);
    if (!loaded) return NextResponse.json({ error: "Reference not found." }, { status: 404 });
    if (!loaded.dna) {
      return NextResponse.json(
        { error: "This reference has no Sound DNA yet. Wait for analysis to finish." },
        { status: 409 },
      );
    }
    dna = loaded.dna;
    sourceTitle = loaded.reference.title;
    sourceArtist = loaded.reference.artist;

    // Measured timing for the visual/workflow renderers (LTX, ComfyUI) — only
    // meaningful for a single reference, which is why this stays inside this
    // branch rather than being computed for the project-level path below.
    if (loaded.analysis) {
      measuredTiming = {
        durationSeconds: loaded.analysis.metadata.duration_seconds,
        sections: loaded.analysis.structure.segments.map((s) => ({
          label: s.label,
          start: s.start,
          end: s.end,
          character: s.character,
        })),
        sectionsReliable: loaded.analysis.structure.reliable,
        energyTrajectoryShape: loaded.analysis.timeline.energy_trajectory_shape,
        peakEnergyTime: loaded.analysis.timeline.peak_energy_time,
      };
    }
  } else if (body.projectId) {
    const refs = loadProjectReferences(body.projectId).filter((r) => r.dna && r.analysis);
    if (refs.length === 0) {
      return NextResponse.json(
        { error: "This project has no analysed references yet." },
        { status: 409 },
      );
    }

    // Build the prompt from the most complete reference, then layer in what
    // the set agrees on. Averaging DNA text across references would produce
    // mush; naming the shared traits explicitly does not.
    dna = refs[0].dna!;
    sourceTitle = refs[0].reference.title;
    sourceArtist = refs[0].reference.artist;

    if (refs.length > 1) {
      const comparison = compareReferences(
        refs.map((r) => ({
          referenceId: r.reference.id,
          title: r.reference.title,
          analysis: r.analysis!,
          dna: r.dna,
        })),
      );
      sharedTraits = comparison.shared
        .filter((s) => s.agreement >= 0.75)
        .slice(0, 8)
        .map((s) => `${s.label}: ${s.value}`);
    }
  } else {
    return NextResponse.json(
      { error: "Provide either referenceId or projectId." },
      { status: 400 },
    );
  }

  let tasteTraits: string[] | undefined;
  if (body.includeTasteProfile) {
    const profile = loadTasteProfile();
    tasteTraits = profile.traits
      .filter((t) => t.confidence >= 0.4)
      .slice(0, 6)
      .map((t) => `${t.trait} (confidence ${t.confidence.toFixed(2)}, ${t.evidence_count} references)`);
    if (tasteTraits.length === 0) tasteTraits = undefined;
  }

  const rendered = renderPrompt(kind, {
    dna,
    modifiers: body.modifiers,
    sharedTraits,
    tasteTraits,
    sourceTitle,
    sourceArtist,
    measuredTiming,
  });

  if (body.save) {
    db.insert(schema.generatedPrompts)
      .values({
        id: randomUUID(),
        projectId: body.projectId ?? null,
        referenceId: body.referenceId ?? null,
        kind,
        modifiers: body.modifiers ?? null,
        body: rendered.body,
      })
      .run();
  }

  return NextResponse.json({ prompt: rendered });
}
