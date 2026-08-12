/**
 * World-baseline integration from the application side.
 *
 * Two things matter most here:
 *
 *  1. **Soundprint works without a baseline.** It is an enhancement, not a
 *     dependency. Every path must degrade to v0 behaviour rather than fail.
 *  2. **No claim escapes the gate.** A percentile with thin support, or from a
 *     single source presented as global, must produce silence rather than
 *     confident-sounding text.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as client from "@/lib/baseline/client";
import * as ctx from "@/lib/baseline/contextualize";
import * as obs from "@/lib/baseline/observations";
import { analysis } from "./fixtures";

const REAL_BASELINE = path.resolve(__dirname, "../../data/baseline/world.db");
const hasRealBaseline = fs.existsSync(REAL_BASELINE);

/**
 * Point the baseline client at a different file.
 *
 * No module reloading needed: the path is resolved from the environment on
 * every call, and the open connection is cached on globalThis. Clearing that
 * cache is enough, and it avoids Vite's restrictions on dynamic imports.
 */
async function freshModules(baselinePath: string | null) {
  if (baselinePath) process.env.SOUNDPRINT_BASELINE_DB = baselinePath;
  else delete process.env.SOUNDPRINT_BASELINE_DB;
  delete (globalThis as Record<string, unknown>).__soundprintBaseline;
  return { client, ctx, obs };
}

describe("baseline absent", () => {
  const original = process.env.SOUNDPRINT_BASELINE_DB;
  let missing: string;

  beforeEach(() => {
    missing = path.join(os.tmpdir(), `soundprint-no-baseline-${Date.now()}.db`);
  });
  afterEach(() => {
    if (original) process.env.SOUNDPRINT_BASELINE_DB = original;
    else delete process.env.SOUNDPRINT_BASELINE_DB;
    delete (globalThis as Record<string, unknown>).__soundprintBaseline;
  });

  it("reports unavailable rather than throwing", async () => {
    const { client } = await freshModules(missing);
    expect(client.baselineAvailable()).toBe(false);
    expect(client.getBaselineInfo()).toBeNull();
  });

  it("returns no contexts instead of failing", async () => {
    const { ctx } = await freshModules(missing);
    expect(ctx.contextualize(analysis())).toEqual([]);
  });

  it("produces no comparative observations", async () => {
    const { obs } = await freshModules(missing);
    const result = obs.comparativeObservations(analysis());
    expect(result.observations).toEqual([]);
    expect(result.baselineVersion).toBeNull();
  });

  it("leaves the analysis untouched when there is nothing to add", async () => {
    const { obs } = await freshModules(missing);
    const a = analysis();
    expect(obs.withComparativeContext(a, [])).toBe(a);
  });

  it("survives a corrupt baseline file the same way as a missing one", async () => {
    const corrupt = path.join(os.tmpdir(), `soundprint-corrupt-${Date.now()}.db`);
    fs.writeFileSync(corrupt, "this is definitely not sqlite");
    try {
      const { client, ctx } = await freshModules(corrupt);
      expect(client.baselineAvailable()).toBe(false);
      expect(ctx.contextualize(analysis())).toEqual([]);
    } finally {
      fs.rmSync(corrupt, { force: true });
    }
  });
});

describe.runIf(hasRealBaseline)("baseline present", () => {
  const original = process.env.SOUNDPRINT_BASELINE_DB;
  afterEach(() => {
    if (original) process.env.SOUNDPRINT_BASELINE_DB = original;
    else delete process.env.SOUNDPRINT_BASELINE_DB;
    delete (globalThis as Record<string, unknown>).__soundprintBaseline;
  });

  it("exposes a versioned baseline with declared datasets", async () => {
    const { client } = await freshModules(REAL_BASELINE);
    const info = client.getBaselineInfo();
    expect(info).not.toBeNull();
    expect(info!.baselineVersion).toMatch(/^world-v/);
    expect(info!.datasets.length).toBeGreaterThan(0);
    for (const d of info!.datasets) {
      expect(d.license).toBeTruthy();
      expect(["observed", "synthetic"]).toContain(d.evidenceClass);
    }
  });

  it("stores the weighting policy so claims are reproducible", async () => {
    const { client } = await freshModules(REAL_BASELINE);
    const policy = client.getBaselineInfo()!.policy;
    expect(policy).not.toBeNull();
    expect(policy!.maxSourceShare).toBeGreaterThan(0);
    expect(policy!.minSupportN).toBeGreaterThanOrEqual(100);
    expect(policy!.minSupportNStrong).toBeGreaterThan(policy!.minSupportN);
  });

  it("reports which datasets contributed to a distribution", async () => {
    const { client } = await freshModules(REAL_BASELINE);
    const dist = client.getDistribution("global-observed", "tempo.bpm", "external");
    expect(dist).not.toBeNull();
    expect(dist!.n).toBeGreaterThan(1000);
    expect(dist!.contributions.length).toBeGreaterThan(0);
    const total = dist!.contributions.reduce((s, c) => s + c.effectiveShare, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("no single source dominates the balanced global distribution completely", async () => {
    const { client } = await freshModules(REAL_BASELINE);
    const dist = client.getDistribution("global-observed", "tempo.bpm", "external")!;
    const biggest = Math.max(...dist.contributions.map((c) => c.effectiveShare));
    const naturalBiggest = Math.max(
      ...dist.contributions.map((c) => c.nRaw / dist.contributions.reduce((s, x) => s + x.nRaw, 0)),
    );
    // Balancing must have pulled the dominant source down from its raw share.
    expect(biggest).toBeLessThan(naturalBiggest);
  });

  it("places a value on the percentile ladder", async () => {
    const { ctx } = await freshModules(REAL_BASELINE);
    const slow = ctx.contextualizeFeature("tempo.bpm", 70, analysis({ tempo: { bpm: 70 } }));
    const fast = ctx.contextualizeFeature("tempo.bpm", 175, analysis({ tempo: { bpm: 175 } }));
    expect(slow).not.toBeNull();
    expect(fast).not.toBeNull();
    const slowP = slow!.contexts.find((c) => c.kind === "global")!.percentile!;
    const fastP = fast!.contexts.find((c) => c.kind === "global")!.percentile!;
    expect(slowP).toBeLessThan(fastP);
  });

  it("labels a lopsided global population descriptive, never strong", async () => {
    const { ctx } = await freshModules(REAL_BASELINE);
    const result = ctx.contextualizeFeature("tempo.bpm", 128, analysis());
    const global = result!.contexts.find((c) => c.kind === "global")!;
    // AcousticBrainz supplies the overwhelming majority of tempo values, so a
    // "strong" global claim would overstate what the corpus supports.
    if ((global.maxSourceShare ?? 0) > 0.85) {
      expect(global.strength).toBe("descriptive");
    }
    expect(global.gateReason).toBeTruthy();
  });

  it("never emits a claim without naming its population and sample size", async () => {
    const { obs } = await freshModules(REAL_BASELINE);
    const result = obs.comparativeObservations(analysis());
    for (const o of result.observations) {
      expect(o.id.startsWith("context.")).toBe(true);
      expect(o.text.length).toBeGreaterThan(10);
      expect(o.evidence.population).toBeTruthy();
      expect(o.evidence.sample_size).toBeTruthy();
      expect(o.evidence.baseline_version).toBeTruthy();
    }
  });

  it("adds comparative observations without mutating the stored analysis", async () => {
    const { obs } = await freshModules(REAL_BASELINE);
    const a = analysis();
    const before = a.observations.length;
    const result = obs.comparativeObservations(a);
    const merged = obs.withComparativeContext(a, result.observations);
    expect(a.observations.length).toBe(before); // original untouched
    expect(merged.observations.length).toBe(before + result.observations.length);
  });

  it("uses the user's own references as a separate context", async () => {
    const { ctx } = await freshModules(REAL_BASELINE);
    const result = ctx.contextualizeFeature("tempo.bpm", 128, analysis(), {
      userValues: [100, 105, 110, 115, 120],
    });
    const user = result!.contexts.find((c) => c.kind === "user");
    expect(user).toBeDefined();
    expect(user!.percentile).toBe(100); // 128 is above all five
    expect(user!.populationId).toBe("user-references");
    // Personal context can never masquerade as a statistical fact.
    expect(user!.strength).toBe("descriptive");
  });

  it("ignores a user context with too few references", async () => {
    const { ctx } = await freshModules(REAL_BASELINE);
    const result = ctx.contextualizeFeature("tempo.bpm", 128, analysis(), {
      userValues: [100, 110],
    });
    expect(result!.contexts.find((c) => c.kind === "user")).toBeUndefined();
  });

  it("keeps world and user contexts distinguishable", async () => {
    const { ctx } = await freshModules(REAL_BASELINE);
    const result = ctx.contextualizeFeature("tempo.bpm", 128, analysis(), {
      userValues: [90, 95, 100, 105],
    });
    const kinds = result!.contexts.map((c) => c.kind);
    expect(kinds).toContain("global");
    expect(kinds).toContain("user");
    // Distinct population ids mean the two can never be conflated downstream.
    const ids = new Set(result!.contexts.map((c) => c.populationId));
    expect(ids.size).toBe(result!.contexts.length);
  });
});
