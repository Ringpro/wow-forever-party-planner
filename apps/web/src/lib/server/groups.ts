// Group use cases. Every function takes the acting user and checks membership/role itself
// (architecture §5.1), so pages and Discord handlers can't skip the check.
import { schema, type Db } from "@muster/db";
import { isValidTimeZone } from "@muster/domain";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { randomToken } from "./crypto.ts";
import { UserError } from "./users.ts";

export type Group = typeof schema.groups.$inferSelect;
export type Membership = {
  role: "admin" | "member";
  shareAvailability: boolean;
  source: "invite" | "discord";
  shareDecidedAt: number | null;
};
export type GroupKind = "server" | "squad" | "private";

export function groupKind(group: Pick<Group, "discordGuildId" | "parentGroupId">): GroupKind {
  if (group.parentGroupId) return "squad";
  return group.discordGuildId ? "server" : "private";
}

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
    db.insert(schema.groupMemberships).values({ groupId, userId: actorId, role: "admin", shareDecidedAt: Date.now() }),
    db.insert(schema.groupInvites).values({ token: randomToken(16), groupId, createdBy: actorId }),
  ]);
  return groupId;
}

export type MyGroup = {
  id: string;
  name: string;
  role: "admin" | "member";
  kind: GroupKind;
  parentGroupId: string | null;
  discordGuildId: string | null;
  iconUrl: string | null;
  shareAvailability: boolean;
  shareDecidedAt: number | null;
};

/** The actor's groups: Discord servers (each followed by its squads), then private groups. */
export async function listMyGroups(db: Db, actorId: string): Promise<MyGroup[]> {
  const rows = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      role: schema.groupMemberships.role,
      parentGroupId: schema.groups.parentGroupId,
      discordGuildId: schema.groups.discordGuildId,
      iconUrl: schema.groups.iconUrl,
      shareAvailability: schema.groupMemberships.shareAvailability,
      shareDecidedAt: schema.groupMemberships.shareDecidedAt,
    })
    .from(schema.groupMemberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMemberships.groupId))
    .where(eq(schema.groupMemberships.userId, actorId))
    .orderBy(asc(schema.groups.name));
  const groups = rows.map((r) => ({ ...r, kind: groupKind(r) }));
  const servers = groups.filter((g) => g.kind === "server");
  return [
    ...servers.flatMap((server) => [server, ...groups.filter((g) => g.parentGroupId === server.id)]),
    ...groups.filter((g) => g.kind === "squad" && !servers.some((s) => s.id === g.parentGroupId)),
    ...groups.filter((g) => g.kind === "private"),
  ];
}

/** The group and the actor's membership, or null if the actor isn't a member. */
export async function getGroupAsMember(
  db: Db,
  actorId: string,
  groupId: string,
): Promise<{ group: Group; membership: Membership } | null> {
  const row = await db
    .select({ group: schema.groups, membership: schema.groupMemberships })
    .from(schema.groupMemberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMemberships.groupId))
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, actorId)))
    .get();
  if (!row) return null;
  const { role, shareAvailability, source, shareDecidedAt } = row.membership;
  return { group: row.group, membership: { role, shareAvailability, source, shareDecidedAt } };
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
    db
      .insert(schema.groupMemberships)
      .values({ groupId: invite.groupId, userId: actorId, shareAvailability, shareDecidedAt: Date.now() }),
    db
      .update(schema.groupInvites)
      .set({ uses: sql`${schema.groupInvites.uses} + 1` })
      .where(eq(schema.groupInvites.token, token)),
  ]);
  return invite.groupId;
}

/** Sets whether the actor shares with a group. For a Discord server this also covers its squads. */
export async function setSharing(db: Db, actorId: string, groupId: string, shareAvailability: boolean): Promise<void> {
  const squads = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.parentGroupId, groupId));
  await db
    .update(schema.groupMemberships)
    .set({ shareAvailability, shareDecidedAt: Date.now() })
    .where(
      and(
        inArray(schema.groupMemberships.groupId, [groupId, ...squads.map((s) => s.id)]),
        eq(schema.groupMemberships.userId, actorId),
      ),
    );
}

export async function leaveGroup(db: Db, actorId: string, groupId: string): Promise<void> {
  const access = await getGroupAsMember(db, actorId, groupId);
  if (!access) return;
  if (access.membership.source === "discord") {
    throw new UserError("You're in this group through Discord. Turn off sharing instead, or leave the Discord server.");
  }
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

export async function updateGroupSettings(
  db: Db,
  actorId: string,
  groupId: string,
  input: { timezone: string; minPlayers: number; gameOnPosts?: boolean },
): Promise<void> {
  await requireAdmin(db, actorId, groupId);
  if (!isValidTimeZone(input.timezone)) throw new UserError("Unknown time zone.");
  if (!Number.isInteger(input.minPlayers) || input.minPlayers < 1 || input.minPlayers > 40) {
    throw new UserError("Players needed must be between 1 and 40.");
  }
  await db
    .update(schema.groups)
    .set({
      timezone: input.timezone,
      minPlayers: input.minPlayers,
      ...(input.gameOnPosts === undefined ? {} : { gameOnPosts: input.gameOnPosts }),
    })
    .where(eq(schema.groups.id, groupId));
}

// ── Discord servers and squads (architecture §4.6) ───────────────────────────────────────
// These take facts already checked against Discord (which servers someone is in, their roles)
// and keep memberships in line with them. Only "discord" memberships are ever changed here.

/** Turns the daily "game on" post on or off for a group's boards. Admins only. */
export async function setGameOnPosts(db: Db, actorId: string, groupId: string, on: boolean): Promise<void> {
  await requireAdmin(db, actorId, groupId);
  await db.update(schema.groups).set({ gameOnPosts: on }).where(eq(schema.groups.id, groupId));
}

export type DiscordServer = { guildId: string; name: string; iconUrl: string | null };

/** Finds the group for a Discord server, creating it the first time. Keeps its name and icon fresh. */
export async function ensureServerGroup(db: Db, server: DiscordServer, timezone: string): Promise<Group> {
  const find = () =>
    db
      .select()
      .from(schema.groups)
      .where(and(eq(schema.groups.discordGuildId, server.guildId), isNull(schema.groups.parentGroupId)))
      .get();
  const existing = await find();
  if (existing) {
    if (existing.name !== server.name || existing.iconUrl !== server.iconUrl) {
      await db
        .update(schema.groups)
        .set({ name: server.name, iconUrl: server.iconUrl })
        .where(eq(schema.groups.id, existing.id));
    }
    return { ...existing, name: server.name, iconUrl: server.iconUrl };
  }
  await db
    .insert(schema.groups)
    .values({
      id: crypto.randomUUID(),
      name: server.name.slice(0, 100),
      timezone,
      discordGuildId: server.guildId,
      iconUrl: server.iconUrl,
    })
    .onConflictDoNothing();
  return (await find())!;
}

/**
 * Makes the user a member of each server group listed, with admin rights following Discord's.
 * `shareByDefault` decides sharing for new memberships: true when they acted in that server
 * themselves, false when we only found the server at login (the website then asks).
 * With `complete`, the list is everything they're in, so Discord memberships of other servers
 * (and those servers' squads) are removed.
 */
export async function syncServerMemberships(
  db: Db,
  userId: string,
  servers: { groupId: string; admin: boolean }[],
  options: { complete: boolean; shareByDefault: boolean },
): Promise<void> {
  const existing = await db.select().from(schema.groupMemberships).where(eq(schema.groupMemberships.userId, userId));
  const byGroup = new Map(existing.map((m) => [m.groupId, m]));
  const now = Date.now();

  for (const { groupId, admin } of servers) {
    const role = admin ? "admin" : "member";
    const membership = byGroup.get(groupId);
    if (!membership) {
      await db
        .insert(schema.groupMemberships)
        .values({
          groupId,
          userId,
          role,
          source: "discord",
          shareAvailability: options.shareByDefault,
          shareDecidedAt: options.shareByDefault ? now : null,
        })
        .onConflictDoNothing();
    } else if (membership.source === "discord" && membership.role !== role) {
      await db
        .update(schema.groupMemberships)
        .set({ role })
        .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.userId, userId)));
    }
  }

  if (options.complete) {
    const keep = servers.map((s) => s.groupId);
    const gone = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .innerJoin(schema.groupMemberships, eq(schema.groupMemberships.groupId, schema.groups.id))
      .where(
        and(
          eq(schema.groupMemberships.userId, userId),
          eq(schema.groupMemberships.source, "discord"),
          isNull(schema.groups.parentGroupId),
          keep.length > 0 ? notInArray(schema.groups.id, keep) : undefined,
        ),
      );
    const goneIds = gone.map((g) => g.id);
    if (goneIds.length > 0) {
      const squads = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(inArray(schema.groups.parentGroupId, goneIds));
      await db
        .delete(schema.groupMemberships)
        .where(
          and(
            eq(schema.groupMemberships.userId, userId),
            eq(schema.groupMemberships.source, "discord"),
            inArray(schema.groupMemberships.groupId, [...goneIds, ...squads.map((s) => s.id)]),
          ),
        );
    }
  }
}

/** Puts the user in exactly the squads of this server whose Discord role they have. */
export async function syncSquadMemberships(
  db: Db,
  userId: string,
  serverGroupId: string,
  roleIds: readonly string[],
): Promise<void> {
  const squads = await db.select().from(schema.groups).where(eq(schema.groups.parentGroupId, serverGroupId));
  if (squads.length === 0) return;
  const parent = await db
    .select()
    .from(schema.groupMemberships)
    .where(and(eq(schema.groupMemberships.groupId, serverGroupId), eq(schema.groupMemberships.userId, userId)))
    .get();
  const memberships = await db
    .select()
    .from(schema.groupMemberships)
    .where(
      and(
        eq(schema.groupMemberships.userId, userId),
        inArray(
          schema.groupMemberships.groupId,
          squads.map((s) => s.id),
        ),
      ),
    );
  const inSquad = new Set(memberships.map((m) => m.groupId));

  for (const squad of squads) {
    const hasRole = squad.discordRoleId !== null && roleIds.includes(squad.discordRoleId);
    if (parent && hasRole && !inSquad.has(squad.id)) {
      await db
        .insert(schema.groupMemberships)
        .values({
          groupId: squad.id,
          userId,
          role: parent.role,
          source: "discord",
          shareAvailability: parent.shareAvailability,
          shareDecidedAt: parent.shareDecidedAt,
        })
        .onConflictDoNothing();
    } else if ((!parent || !hasRole) && inSquad.has(squad.id)) {
      await db
        .delete(schema.groupMemberships)
        .where(
          and(
            eq(schema.groupMemberships.groupId, squad.id),
            eq(schema.groupMemberships.userId, userId),
            eq(schema.groupMemberships.source, "discord"),
          ),
        );
    }
  }
}

/** Creates a squad inside a Discord server group, tied to a Discord role. Server admins only. */
export async function createSquad(
  db: Db,
  actorId: string,
  serverGroupId: string,
  input: { name: string; roleId: string },
): Promise<string> {
  const { group } = await requireAdmin(db, actorId, serverGroupId);
  if (groupKind(group) !== "server") throw new UserError("Squads can only be made inside a Discord server.");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) throw new UserError("Give the squad a name (up to 60 characters).");
  if (!/^\d{5,25}$/.test(input.roleId)) throw new UserError("Pick a Discord role.");
  const existing = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.parentGroupId, group.id), eq(schema.groups.discordRoleId, input.roleId)))
    .get();
  if (existing) throw new UserError("There is already a squad for that role.");
  const id = crypto.randomUUID();
  await db.insert(schema.groups).values({
    id,
    name,
    timezone: group.timezone,
    minPlayers: group.minPlayers,
    discordGuildId: group.discordGuildId,
    discordRoleId: input.roleId,
    parentGroupId: group.id,
    createdBy: actorId,
  });
  return id;
}

/** Deletes a squad. Admins of its server only. Returns the server group's id. */
export async function deleteSquad(db: Db, actorId: string, squadId: string): Promise<string> {
  const squad = await db.select().from(schema.groups).where(eq(schema.groups.id, squadId)).get();
  if (!squad?.parentGroupId) throw new UserError("That squad doesn't exist.");
  await requireAdmin(db, actorId, squad.parentGroupId);
  await db.delete(schema.groups).where(eq(schema.groups.id, squadId));
  return squad.parentGroupId;
}

export async function listSquads(db: Db, serverGroupId: string) {
  return db
    .select({ id: schema.groups.id, name: schema.groups.name, roleId: schema.groups.discordRoleId })
    .from(schema.groups)
    .where(eq(schema.groups.parentGroupId, serverGroupId))
    .orderBy(asc(schema.groups.name));
}

/** The group for a Discord server, if Muster knows it. */
export async function serverGroupFor(db: Db, guildId: string): Promise<Group | undefined> {
  return db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.discordGuildId, guildId), isNull(schema.groups.parentGroupId)))
    .get();
}
