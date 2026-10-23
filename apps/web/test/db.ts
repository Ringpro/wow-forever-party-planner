// A real local D1 database (not persisted to disk) with all migrations applied, for tests.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { createDb, schema, type Db } from "@party/db";
import { eq } from "drizzle-orm";
import { findOrCreateDiscordUser, getUser, setTimezone } from "../src/lib/server/users.ts";
import type { SessionUser } from "../src/lib/server/session.ts";

const MIGRATIONS = new URL("../../../packages/db/migrations/", import.meta.url);

export async function createTestDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
  });
  const d1 = proxy.env.DB;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(new URL(file, MIGRATIONS), "utf8").split("--> statement-breakpoint");
    for (const statement of statements.map((s) => s.trim()).filter(Boolean)) await d1.prepare(statement).run();
  }
  return { db: createDb(d1), dispose: () => proxy.dispose() };
}

export async function createUser(db: Db, name: string, timezone: string): Promise<SessionUser> {
  const id = await findOrCreateDiscordUser(db, { id: `test-${name}`, username: name.toLowerCase(), displayName: name });
  await setTimezone(db, id, timezone);
  return (await getUser(db, id))!;
}

/** Limits an existing entry to the given groups (the per-day sharing UI doesn't exist yet). */
export async function limitEntryToGroups(db: Db, userId: string, day: string, groupIds: string[]): Promise<void> {
  const entry = await db
    .select()
    .from(schema.availabilityEntries)
    .where(eq(schema.availabilityEntries.userId, userId))
    .all()
    .then((rows) => rows.find((r) => r.localDate === day)!);
  await db
    .update(schema.availabilityEntries)
    .set({ shareScope: "selected" })
    .where(eq(schema.availabilityEntries.id, entry.id));
  for (const groupId of groupIds) {
    await db.insert(schema.availabilityEntryGroups).values({ entryId: entry.id, groupId });
  }
}
