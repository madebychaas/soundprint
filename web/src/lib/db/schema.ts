/**
 * Persistence schema.
 *
 * Two design choices worth stating:
 *
 * 1. Audio files are referenced by a *storage key* plus a backend
 *    discriminator, never by an absolute path. Today the backend is always
 *    "local" and the key is a path relative to the data directory. Swapping in
 *    object storage means adding a backend value and a resolver, not migrating
 *    the schema.
 *
 * 2. Objective analysis and interpreted Sound DNA are separate tables with
 *    separate version columns. They have different lifecycles: improving the
 *    analyser invalidates analyses, while changing the interpretation prompt or
 *    switching model provider invalidates only DNA. Keeping them together would
 *    force expensive re-analysis for cheap interpretation changes.
 */

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export type ReferenceStatus =
  | "uploaded"
  | "analyzing"
  | "interpreting"
  | "complete"
  | "partial"
  | "failed";

export const references = sqliteTable(
  "references",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    artist: text("artist"),
    sourceFilename: text("source_filename").notNull(),
    storageBackend: text("storage_backend").notNull().default("local"),
    storageKey: text("storage_key").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    durationSeconds: real("duration_seconds"),
    status: text("status").$type<ReferenceStatus>().notNull().default("uploaded"),
    statusDetail: text("status_detail"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("references_project_idx").on(t.projectId)],
);

/** Objective measurement output. Expensive; never recomputed unless stale. */
export const analyses = sqliteTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    analyzerVersion: text("analyzer_version").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    durationMs: integer("duration_ms"),
    partial: integer("partial", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("analyses_reference_idx").on(t.referenceId)],
);

/** Interpreted profile. Cheap to regenerate; carries its own provenance. */
export const soundDna = sqliteTable(
  "sound_dna",
  {
    id: text("id").primaryKey(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    /** Model output, validated against the DNA schema before storage. */
    payload: text("payload", { mode: "json" }).notNull(),
    /**
     * User edits kept separate from the generated payload so regenerating
     * interpretation never silently discards the user's own corrections.
     */
    userEdits: text("user_edits", { mode: "json" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("dna_reference_idx").on(t.referenceId)],
);

export type Rating = "love" | "like" | "neutral" | "not_for_me";

export const ratings = sqliteTable("ratings", {
  referenceId: text("reference_id")
    .primaryKey()
    .references(() => references.id, { onDelete: "cascade" }),
  rating: text("rating").$type<Rating>().notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

/**
 * Free-text user notes.
 *
 * These outrank model inference everywhere they conflict: the user has heard
 * the track and the model has only measurements of it.
 */
export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("notes_reference_idx").on(t.referenceId)],
);

export const generatedPrompts = sqliteTable(
  "generated_prompts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    referenceId: text("reference_id").references(() => references.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    modifiers: text("modifiers", { mode: "json" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("prompts_project_idx").on(t.projectId)],
);

/**
 * The persistent taste profile.
 *
 * Single row for the MVP (`id = 'local'`), but keyed so multiple profiles can
 * exist later without a migration.
 */
export const tasteProfiles = sqliteTable("taste_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  evidenceCount: integer("evidence_count").notNull().default(0),
  computedAt: integer("computed_at").notNull().default(now),
});

/**
 * One row per (trait, reference) observation supporting the taste profile.
 *
 * Storing evidence rather than only the aggregate is what makes a trait
 * explainable — the UI can show *which* references produced a tendency, and
 * confidence can be recomputed when a rating changes without re-reading DNA.
 */
export const tasteEvidence = sqliteTable(
  "taste_evidence",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => tasteProfiles.id, { onDelete: "cascade" }),
    trait: text("trait").notNull(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    /** Signed: positive supports the trait, negative contradicts it. */
    weight: real("weight").notNull(),
    detail: text("detail"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("evidence_profile_idx").on(t.profileId),
    uniqueIndex("evidence_unique_idx").on(t.profileId, t.trait, t.referenceId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type SoundDnaRow = typeof soundDna.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
export type TasteProfileRow = typeof tasteProfiles.$inferSelect;
export type TasteEvidenceRow = typeof tasteEvidence.$inferSelect;
