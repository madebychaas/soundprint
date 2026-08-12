import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
  return NextResponse.json({ projects: rows });
}

export async function POST(request: Request) {
  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "Project name is too long (max 120 characters)." }, { status: 400 });
  }

  const id = randomUUID();
  db.insert(schema.projects)
    .values({ id, name, description: body.description?.trim() || null })
    .run();

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  return NextResponse.json({ project }, { status: 201 });
}
