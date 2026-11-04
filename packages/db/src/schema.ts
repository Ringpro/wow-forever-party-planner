// First-pass schema for the scheduling MVP. Rules it follows: docs/architecture.md §4.
// Timestamps are UTC epoch milliseconds. Local dates are 'YYYY-MM-DD', wall times 'HH:MM'.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;
const createdAt = () => integer("created_at", { mode: "number" }).notNull().default(now);
const updatedAt = () => integer("updated_at", { mode: "number" }).notNull().default(now);

// Our own users. A Discord-only user has no website session but is still a full user (§4.1).
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  timezone: text("timezone"), // IANA; null until the user has picked one
  defaultSessionMinutes: integer("default_session_minutes").notNull().default(120),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userIdentities = sqliteTable(
  "user_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["discord"] }).notNull(),
    externalId: text("external_id").notNull(),
    username: text("username"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_identities_provider_external").on(t.provider, t.externalId)],
);

// Website login sessions. `id` is the SHA-256 of the cookie token, never the token itself.
export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: createdAt(),
});

// Three kinds of group (architecture §4.6):
//   Discord server: discordGuildId set, no parent. Members are whoever in the server uses Muster.
//   Squad: inside a server group (parentGroupId), members are the server members with discordRoleId.
//   Private group: neither set; members join with an invite link.
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    minPlayers: integer("min_players").notNull().default(3),
    minOverlapMinutes: integer("min_overlap_minutes").notNull().default(60),
    discordGuildId: text("discord_guild_id"),
    discordRoleId: text("discord_role_id"),
    parentGroupId: text("parent_group_id").references((): AnySQLiteColumn => groups.id, { onDelete: "cascade" }),
    iconUrl: text("icon_url"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("groups_server_guild").on(t.discordGuildId).where(sql`parent_group_id is null`),
    uniqueIndex("groups_squad_role").on(t.parentGroupId, t.discordRoleId),
  ],
);

export const groupMemberships = sqliteTable(
  "group_memberships",
  {
    groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    shareAvailability: integer("share_availability", { mode: "boolean" }).notNull().default(true),
    // "discord" memberships are kept in sync with Discord; "invite" ones are only changed by people.
    source: text("source", { enum: ["invite", "discord"] }).notNull().default("invite"),
    // Set once the user has chosen whether to share with this group. Servers found at login start
    // unshared and undecided, so the website can ask instead of sharing silently.
    shareDecidedAt: integer("share_decided_at"),
    joinedAt: integer("joined_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_memberships_user").on(t.userId)],
);

export const groupInvites = sqliteTable("group_invites", {
  token: text("token").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: integer("expires_at"),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  revokedAt: integer("revoked_at"),
  createdAt: createdAt(),
});

// One row per time slot per user per gaming day ("no" is a single row in slot 0).
// Groups see it through sharing rules, never own it (§4.2).
export const availabilityEntries = sqliteTable(
  "availability_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    slot: integer("slot").notNull().default(0),
    status: text("status", { enum: ["yes", "maybe", "no"] }).notNull(),
    startLocal: text("start_local"),
    endLocal: text("end_local"),
    tz: text("tz").notNull(),
    startsAt: integer("starts_at"),
    endsAt: integer("ends_at"),
    shareScope: text("share_scope", { enum: ["all_shared_groups", "selected"] })
      .notNull()
      .default("all_shared_groups"),
    source: text("source", { enum: ["web", "discord"] }).notNull(),
    lastRelativeShiftAt: integer("last_relative_shift_at"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("availability_entries_user_date_slot").on(t.userId, t.localDate, t.slot)],
);

// Only used when share_scope = 'selected'.
export const availabilityEntryGroups = sqliteTable(
  "availability_entry_groups",
  {
    entryId: text("entry_id").notNull().references(() => availabilityEntries.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.groupId] })],
);

export const weeklyDefaults = sqliteTable(
  "weekly_defaults",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // ISO: 1 = Monday … 7 = Sunday
    slot: integer("slot").notNull().default(0),
    status: text("status", { enum: ["yes", "maybe", "no"] }).notNull(),
    startLocal: text("start_local"),
    endLocal: text("end_local"),
    tz: text("tz").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekday, t.slot] })],
);

export const WOW_CLASSES = [
  "warrior",
  "paladin",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
] as const;

export const ROLES = ["tank", "healer", "dps"] as const;
export const REALM_TYPES = ["pvp", "pve", "rp_pvp", "rp_pve"] as const;

export const characters = sqliteTable(
  "characters",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    realmType: text("realm_type", { enum: REALM_TYPES }),
    /** Comma-separated subset of ROLES, e.g. "tank,healer". */
    roles: text("roles").notNull().default(""),
    faction: text("faction", { enum: ["alliance", "horde"] }).notNull(),
    class: text("class", { enum: WOW_CLASSES }).notNull(),
    level: integer("level").notNull().default(1),
    isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
    source: text("source", { enum: ["web", "discord", "addon"] }).notNull().default("web"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("characters_user").on(t.userId)],
);

export const freeNow = sqliteTable("free_now", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: updatedAt(),
});

export const discordBoards = sqliteTable("discord_boards", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull().unique(),
  messageId: text("message_id"),
  dirtySince: integer("dirty_since"),
  lastRenderedAt: integer("last_rendered_at"),
  lastRenderHash: text("last_render_hash"),
  createdAt: createdAt(),
});
