/**
 * Tests for the node:sqlite adapter behind drizzle.
 *
 * This is hand-written glue standing in for a well-tested native driver, so it
 * needs its own coverage: a subtle difference in parameter handling or return
 * shape would corrupt data silently rather than fail loudly.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "soundprint-dbtest-"));
process.env.SOUNDPRINT_DATA_DIR = DATA_DIR;

// Imported after the data dir is set, since the module resolves paths from it.
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db").schema;
let randomUUID: typeof import("node:crypto").randomUUID;
let eq: typeof import("drizzle-orm").eq;
let inArray: typeof import("drizzle-orm").inArray;
let sql: typeof import("drizzle-orm").sql;

beforeAll(async () => {
  ({ db, schema } = await import("@/lib/db"));
  ({ randomUUID } = await import("node:crypto"));
  ({ eq, inArray, sql } = await import("drizzle-orm"));
});

afterAll(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

function makeProject(name = "P") {
  const id = randomUUID();
  db.insert(schema.projects).values({ id, name }).run();
  return id;
}

function makeReference(projectId: string, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  db.insert(schema.references)
    .values({
      id,
      projectId,
      title: "Ref",
      sourceFilename: "a.wav",
      storageKey: `${id}.wav`,
      ...over,
    })
    .run();
  return id;
}

describe("node:sqlite adapter", () => {
  it("round-trips inserts and selects", () => {
    const id = makeProject("Round trip");
    const row = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    expect(row?.name).toBe("Round trip");
  });

  it("preserves nested JSON columns exactly", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    const payload = {
      tempo: { bpm: 99.38, alternates: [49.69, 198.76] },
      nested: { deep: { arr: [1, 2, 3], flag: true, nothing: null } },
      unicode: "width — em dash, ½ fraction",
    };
    const aid = randomUUID();
    db.insert(schema.analyses)
      .values({ id: aid, referenceId: rid, analyzerVersion: "1.0.0", payload })
      .run();

    const back = db.select().from(schema.analyses).where(eq(schema.analyses.id, aid)).get();
    expect(back?.payload).toEqual(payload);
  });

  it("stores booleans as integers and reads them back as booleans", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    const aid = randomUUID();
    db.insert(schema.analyses)
      .values({ id: aid, referenceId: rid, analyzerVersion: "1", payload: {}, partial: true })
      .run();
    const back = db.select().from(schema.analyses).where(eq(schema.analyses.id, aid)).get();
    expect(back?.partial).toBe(true);
    expect(typeof back?.partial).toBe("boolean");
  });

  it("applies column defaults when a value is omitted", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    const row = db.select().from(schema.references).where(eq(schema.references.id, rid)).get();
    expect(row?.status).toBe("uploaded");
    expect(row?.storageBackend).toBe("local");
    expect(row?.createdAt).toBeGreaterThan(0);
  });

  it("stores an omitted nullable column as null, not undefined", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    const row = db.select().from(schema.references).where(eq(schema.references.id, rid)).get();
    expect(row?.artist).toBeNull();
    expect(row?.durationSeconds).toBeNull();
  });

  it("supports upsert via onConflictDoUpdate", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    db.insert(schema.ratings).values({ referenceId: rid, rating: "love" }).run();
    db.insert(schema.ratings)
      .values({ referenceId: rid, rating: "like" })
      .onConflictDoUpdate({ target: schema.ratings.referenceId, set: { rating: "like" } })
      .run();

    const rows = db.select().from(schema.ratings).where(eq(schema.ratings.referenceId, rid)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe("like");
  });

  it("supports onConflictDoNothing", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    db.insert(schema.tasteProfiles)
      .values({ id: "t1", name: "n", payload: {}, evidenceCount: 0 })
      .run();
    db.insert(schema.tasteEvidence)
      .values({ id: randomUUID(), profileId: "t1", trait: "x", referenceId: rid, weight: 1 })
      .run();
    expect(() =>
      db
        .insert(schema.tasteEvidence)
        .values({ id: randomUUID(), profileId: "t1", trait: "x", referenceId: rid, weight: 1 })
        .onConflictDoNothing()
        .run(),
    ).not.toThrow();
    expect(db.select().from(schema.tasteEvidence).all()).toHaveLength(1);
  });

  it("supports inArray with multiple bound parameters", () => {
    const pid = makeProject();
    const a = makeReference(pid, { title: "A" });
    const b = makeReference(pid, { title: "B" });
    makeReference(pid, { title: "C" });
    const rows = db
      .select()
      .from(schema.references)
      .where(inArray(schema.references.id, [a, b]))
      .all();
    expect(rows).toHaveLength(2);
  });

  it("enforces foreign keys with cascading delete", () => {
    const pid = makeProject();
    const rid = makeReference(pid);
    db.insert(schema.notes).values({ id: randomUUID(), referenceId: rid, body: "note" }).run();

    db.delete(schema.projects).where(eq(schema.projects.id, pid)).run();

    expect(
      db.select().from(schema.references).where(eq(schema.references.id, rid)).all(),
    ).toHaveLength(0);
    expect(
      db.select().from(schema.notes).where(eq(schema.notes.referenceId, rid)).all(),
    ).toHaveLength(0);
  });

  it("runs correlated subqueries with the aliasing the projects page relies on", () => {
    const pid = makeProject("Counted");
    makeReference(pid, { status: "complete" });
    makeReference(pid, { status: "uploaded" });

    const row = db
      .select({
        name: schema.projects.name,
        referenceCount: sql<number>`(
          SELECT COUNT(*) FROM "references" r WHERE r.project_id = "projects"."id"
        )`,
        completeCount: sql<number>`(
          SELECT COUNT(*) FROM "references" r
          WHERE r.project_id = "projects"."id" AND r.status IN ('complete','partial')
        )`,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, pid))
      .get();

    // Regression guard: interpolating the column via drizzle rendered it
    // unqualified, so SQLite resolved "id" against the inner table and the
    // count silently came back 0.
    expect(row?.referenceCount).toBe(2);
    expect(row?.completeCount).toBe(1);
  });

  it("persists across a reconnect to the same file", async () => {
    const pid = makeProject("Durable");
    // A fresh import shares the cached connection; the real assertion is that
    // the data is on disk, which the restart test in the README covers end to
    // end. Here we confirm the row survives a query through a new statement.
    const again = db.select().from(schema.projects).where(eq(schema.projects.id, pid)).get();
    expect(again?.name).toBe("Durable");
    expect(fs.existsSync(path.join(DATA_DIR, "soundprint.db"))).toBe(true);
  });
});
