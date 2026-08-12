/**
 * Portability proofs.
 *
 * The target: a fresh supported machine runs Soundprint without inheriting
 * undocumented state from the machine it was first built on. These tests pin
 * the properties that make that true — configuration resolves from the
 * environment, nothing critical is hard-coded, and every optional dependency
 * has a defined absent-behaviour.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { config, dataDir, appDatabasePath, baselineDatabasePath, audioDir } from "@/lib/config";

const ENV_KEYS = [
  "SOUNDPRINT_DATA_DIR", "SOUNDPRINT_APP_DB", "SOUNDPRINT_BASELINE_DB",
  "SOUNDPRINT_AUDIO_DIR", "AUDIO_SERVICE_URL", "SOUNDPRINT_MAX_UPLOAD_MB",
  "SOUNDPRINT_LLM_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL",
];

describe("configuration resolution", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("honours an explicit data directory", () => {
    const tmp = path.join(os.tmpdir(), "sp-config-test");
    process.env.SOUNDPRINT_DATA_DIR = tmp;
    expect(dataDir()).toBe(path.resolve(tmp));
    expect(appDatabasePath()).toBe(path.join(path.resolve(tmp), "soundprint.db"));
    expect(audioDir()).toBe(path.join(path.resolve(tmp), "audio"));
  });

  it("keeps the baseline separate from user data by default", () => {
    process.env.SOUNDPRINT_DATA_DIR = "/tmp/sp-sep";
    delete process.env.SOUNDPRINT_BASELINE_DB;
    // Different files, so either can be replaced without touching the other.
    expect(baselineDatabasePath()).not.toBe(appDatabasePath());
    expect(baselineDatabasePath()).toContain("baseline");
  });

  it("lets the baseline live anywhere, including read-only or shared storage", () => {
    process.env.SOUNDPRINT_BASELINE_DB = "/opt/soundprint/shared/world.db";
    expect(baselineDatabasePath()).toBe("/opt/soundprint/shared/world.db");
  });

  it("lets each path be overridden independently", () => {
    process.env.SOUNDPRINT_DATA_DIR = "/tmp/a";
    process.env.SOUNDPRINT_APP_DB = "/tmp/b/app.db";
    process.env.SOUNDPRINT_AUDIO_DIR = "/tmp/c/audio";
    expect(appDatabasePath()).toBe("/tmp/b/app.db");
    expect(audioDir()).toBe("/tmp/c/audio");
    expect(dataDir()).toBe("/tmp/a");
  });

  it("produces absolute paths so cwd cannot relocate the database", () => {
    process.env.SOUNDPRINT_DATA_DIR = "relative/path";
    expect(path.isAbsolute(dataDir())).toBe(true);
    expect(path.isAbsolute(appDatabasePath())).toBe(true);
  });

  it("has a working default for every value", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(config.audioServiceUrl).toBe("http://127.0.0.1:8000");
    expect(config.maxUploadBytes).toBeGreaterThan(0);
    expect(config.maxDurationSeconds).toBeGreaterThan(0);
    expect(config.llmProvider).toBeNull();
    expect(path.isAbsolute(config.appDatabase)).toBe(true);
  });

  it("reads limits from the environment", () => {
    process.env.SOUNDPRINT_MAX_UPLOAD_MB = "25";
    expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
  });

  it("falls back to the default when a numeric value is nonsense", () => {
    process.env.SOUNDPRINT_MAX_UPLOAD_MB = "not-a-number";
    expect(config.maxUploadBytes).toBe(100 * 1024 * 1024);
  });

  it("contains no path from the original development machine", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/lib/config.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\/Users\/[a-z]/i);
    expect(source).not.toMatch(/\/home\/[a-z]/i);
    expect(source).not.toMatch(/C:\\/);
  });
});

describe("interpretation provider portability", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "SOUNDPRINT_LLM_PROVIDER"]) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("always resolves a provider, even with nothing configured", async () => {
    const { resolveProvider } = await import("@/lib/interpretation");
    const provider = await resolveProvider();
    expect(provider).toBeTruthy();
    expect(provider.id).toBeTruthy();
  });

  it("keeps a no-network provider available on every machine", async () => {
    const { listProviderAvailability } = await import("@/lib/interpretation");
    const providers = await listProviderAvailability();
    const offline = providers.filter((p) => !p.requiresNetwork && p.available);
    expect(offline.length).toBeGreaterThan(0);
    expect(offline.map((p) => p.id)).toContain("heuristic");
  });

  it("explains why each unavailable provider is unavailable", async () => {
    const { listProviderAvailability } = await import("@/lib/interpretation");
    for (const p of await listProviderAvailability()) {
      if (!p.available) expect(p.reason, `${p.id} has no reason`).toBeTruthy();
    }
  });

  it("honours an explicit provider choice", async () => {
    process.env.SOUNDPRINT_LLM_PROVIDER = "heuristic";
    const { resolveProvider } = await import("@/lib/interpretation");
    expect((await resolveProvider()).id).toBe("heuristic");
  });

  it("rejects an unknown provider name loudly", async () => {
    process.env.SOUNDPRINT_LLM_PROVIDER = "not-a-provider";
    const { resolveProvider } = await import("@/lib/interpretation");
    await expect(resolveProvider()).rejects.toThrow(/Unknown provider/);
  });

  it("reads an OpenAI-compatible base URL so a local model can be used", async () => {
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    const { getProviderById } = await import("@/lib/interpretation");
    const availability = await getProviderById("openai")!.availability();
    // A custom base URL implies a local server that needs no key.
    expect(availability.available).toBe(true);
    expect(availability.label).toContain("localhost:11434");
  });

  it("hard-codes no secrets", () => {
    const dir = path.resolve(__dirname, "../src/lib/interpretation");
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      expect(src, file).not.toMatch(/sk-ant-[A-Za-z0-9]/);
      expect(src, file).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });
});

describe("audio service client portability", () => {
  const saved = process.env.AUDIO_SERVICE_URL;
  afterEach(() => {
    if (saved) process.env.AUDIO_SERVICE_URL = saved;
    else delete process.env.AUDIO_SERVICE_URL;
  });

  it("reads the service URL at call time, not at import", async () => {
    const { audioServiceUrl } = await import("@/lib/analysis/client");
    process.env.AUDIO_SERVICE_URL = "http://analyzer.internal:9000";
    expect(audioServiceUrl()).toBe("http://analyzer.internal:9000");
    delete process.env.AUDIO_SERVICE_URL;
    expect(audioServiceUrl()).toBe("http://127.0.0.1:8000");
  });

  it("names the URL and a fix when the service is unreachable", async () => {
    const { analyzeFile } = await import("@/lib/analysis/client");
    process.env.AUDIO_SERVICE_URL = "http://127.0.0.1:1";
    const tmp = path.join(os.tmpdir(), `sp-probe-${Date.now()}.wav`);
    fs.writeFileSync(tmp, "x");
    try {
      await analyzeFile(tmp, "probe.wav").then(
        () => expect.fail("should have thrown"),
        (err) => {
          expect(err.kind).toBe("unavailable");
          expect(err.message).toContain("127.0.0.1:1");
          expect(err.hint).toContain("uvicorn");
        },
      );
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});
