import { schema, type Db } from "@party/db";
import { isValidTimeZone } from "@party/domain";
import { and, eq } from "drizzle-orm";
import type { SessionUser } from "./session.ts";

/** Finds the user behind a Discord account, creating one on first sight (architecture §4.1). */
export async function findOrCreateDiscordUser(
  db: Db,
  discord: { id: string; username: string; displayName: string },
): Promise<string> {
  const existing = await db
    .select({ userId: schema.userIdentities.userId, username: schema.userIdentities.username })
    .from(schema.userIdentities)
    .where(and(eq(schema.userIdentities.provider, "discord"), eq(schema.userIdentities.externalId, discord.id)))
    .get();
  if (existing) {
    if (existing.username !== discord.username) {
      await db
        .update(schema.userIdentities)
        .set({ username: discord.username })
        .where(and(eq(schema.userIdentities.provider, "discord"), eq(schema.userIdentities.externalId, discord.id)));
    }
    return existing.userId;
  }

  const userId = crypto.randomUUID();
  await db.batch([
    db.insert(schema.users).values({ id: userId, displayName: discord.displayName.slice(0, 80) }),
    db.insert(schema.userIdentities).values({
      id: crypto.randomUUID(),
      userId,
      provider: "discord",
      externalId: discord.id,
      username: discord.username,
    }),
  ]);
  return userId;
}

export async function getUser(db: Db, userId: string): Promise<SessionUser | null> {
  const user = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      timezone: schema.users.timezone,
      defaultSessionMinutes: schema.users.defaultSessionMinutes,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return user ?? null;
}

export async function setTimezone(db: Db, userId: string, timezone: string): Promise<void> {
  if (!isValidTimeZone(timezone)) throw new UserError("Unknown time zone.");
  await db.update(schema.users).set({ timezone, updatedAt: Date.now() }).where(eq(schema.users.id, userId));
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}
