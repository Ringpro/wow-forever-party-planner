// Group use cases. Every function takes the acting user and checks membership/role itself
// (architecture §5.1), so pages and Discord handlers can't skip the check.
import { schema, type Db } from "@party/db";
import { isValidTimeZone } from "@party/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { randomToken } from "./crypto.ts";
import { UserError } from "./users.ts";

export type Group = typeof schema.groups.$inferSelect;
export type Membership = { role: "admin" | "member"; shareAvailability: boolean };

export async function createGroup(
  db: Db,
  actorId: string,
  input: { name: string; timezone: string; minPlayers: number },
): Promise<string> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) throw new UserError("Give the group a name (up to 60 characters).");
  if (!isValidTimeZone(input.timezone)) throw new UserError("Unknown time zone.");
  if (!Number.isInteger(input.minPlayers) || input.minPlayers < 1 || input.minPlayers > 40) {
    throw new UserError("Minimum players must be between 1 and 40.");
  }

  const groupId = crypto.randomUUID();
  await db.batch([
    db.insert(schema.groups).values({
      id: groupId,
      name,
      timezone: input.timezone,
      minPlayers: input.minPlayers,
      createdBy: actorId,
    }),
    db.insert(schema.groupMemberships).values({ groupId, userId: actorId, role: "admin" }),
    db.insert(schema.groupInvites).values({ token: randomToken(16), groupId, createdBy: actorId }),
  ]);
  return groupId;
}

export async function listMyGroups(db: Db, actorId: string) {
  return db
    .select({ id: schema.groups.id, name: schema.groups.name, role: schema.groupMemberships.role })
    .from(schema.groupMemberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMemberships.groupId))
    .where(eq(schema.groupMemberships.userId, actorId))
    .orderBy(asc(schema.groups.name));
}

/** The group and the actor's membership, or null if the actor isn't a member. */
export async function getGroupAsMember(
  db: Db,
  actorId: string,
  groupId: string,
): Promise<{ group: Group; membership: Membership } | null> {
  const row = await db
    .select({ group: schema.groups, role: schema.groupMemberships.role, share: schema.groupMemberships.shareAvailability })
    .from(schema.groupMemberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMemberships.groupId))
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, actorId)))
    .get();
  return row ? { group: row.group, membership: { role: row.role, shareAvailability: row.share } } : null;
}

async function requireAdmin(db: Db, actorId: string, groupId: string) {
  const access = await getGroupAsMember(db, actorId, groupId);
  if (access?.membership.role !== "admin") throw new UserError("Only group admins can do that.");
  return access;
}

/** The group's active invite token, for admins only. */
export async function getInviteToken(db: Db, actorId: string, groupId: string): Promise<string> {
  await requireAdmin(db, actorId, groupId);
  const invite = await db
    .select({ token: schema.groupInvites.token })
    .from(schema.groupInvites)
    .where(and(eq(schema.groupInvites.groupId, groupId), isNull(schema.groupInvites.revokedAt)))
    .get();
  if (invite) return invite.token;
  const token = randomToken(16);
  await db.insert(schema.groupInvites).values({ token, groupId, createdBy: actorId });
  return token;
}

/** Revokes the current invite link and creates a new one. */
export async function resetInvite(db: Db, actorId: string, groupId: string): Promise<void> {
  await requireAdmin(db, actorId, groupId);
  const token = randomToken(16);
  await db.batch([
    db
      .update(schema.groupInvites)
      .set({ revokedAt: Date.now() })
      .where(and(eq(schema.groupInvites.groupId, groupId), isNull(schema.groupInvites.revokedAt))),
    db.insert(schema.groupInvites).values({ token, groupId, createdBy: actorId }),
  ]);
}

/** The group behind a usable invite token. Shows only the name, never members. */
export async function findInvite(db: Db, token: string): Promise<{ groupId: string; groupName: string } | null> {
  const row = await db
    .select({ invite: schema.groupInvites, groupName: schema.groups.name })
    .from(schema.groupInvites)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupInvites.groupId))
    .where(eq(schema.groupInvites.token, token))
    .get();
  if (!row) return null;
  const { invite } = row;
  if (invite.revokedAt) return null;
  if (invite.expiresAt && invite.expiresAt <= Date.now()) return null;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return null;
  return { groupId: invite.groupId, groupName: row.groupName };
}

export async function joinGroup(db: Db, actorId: string, token: string, shareAvailability: boolean): Promise<string> {
  const invite = await findInvite(db, token);
  if (!invite) throw new UserError("This invite link is no longer valid. Ask the group for a new one.");
  if (await getGroupAsMember(db, actorId, invite.groupId)) return invite.groupId;

  await db.batch([
    db.insert(schema.groupMemberships).values({ groupId: invite.groupId, userId: actorId, shareAvailability }),
    db
      .update(schema.groupInvites)
      .set({ uses: sql`${schema.groupInvites.uses} + 1` })
      .where(eq(schema.groupInvites.token, token)),
  ]);
  return invite.groupId;
}

export async function setSharing(db: Db, actorId: string, groupId: string, shareAvailability: boolean): Promise<void> {
  await db
    .update(schema.groupMemberships)
    .set({ shareAvailability })
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, actorId)));
}

export async function leaveGroup(db: Db, actorId: string, groupId: string): Promise<void> {
  const access = await getGroupAsMember(db, actorId, groupId);
  if (!access) return;
  if (access.membership.role === "admin") {
    const admins = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.groupMemberships)
      .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.role, "admin")))
      .get();
    const members = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.groupMemberships)
      .where(eq(schema.groupMemberships.groupId, groupId))
      .get();
    if ((members?.count ?? 0) <= 1) {
      // Last member out: remove the group entirely.
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
      return;
    }
    if ((admins?.count ?? 0) <= 1) {
      throw new UserError("You're the only admin. Make someone else admin before leaving.");
    }
  }
  await db
    .delete(schema.groupMemberships)
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, actorId)));
}

export async function makeAdmin(db: Db, actorId: string, groupId: string, memberId: string): Promise<void> {
  await requireAdmin(db, actorId, groupId);
  await db
    .update(schema.groupMemberships)
    .set({ role: "admin" })
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, memberId)));
}
