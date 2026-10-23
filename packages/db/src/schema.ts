// First-pass schema for the scheduling MVP. Rules it follows: docs/architecture.md §4.
// Timestamps are UTC epoch milliseconds. Local dates are 'YYYY-MM-DD', wall times 'HH:MM'.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  minPlayers: integer("min_players").notNull().default(3),
  minOverlapMinutes: integer("min_overlap_minutes").notNull().default(60),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const groupMemberships = sqliteTable(
  "group_memberships",
  {
    groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    shareAvailability: integer("share_availability", { mode: "boolean" }).notNull().default(true),
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

// One row per user per gaming day. Groups see it through sharing rules, never own it (§4.2).
export const availabilityEntries = sqliteTable(
  "availability_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
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
  (t) => [uniqueIndex("availability_entries_user_date").on(t.userId, t.localDate)],
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
    status: text("status", { enum: ["yes", "maybe", "no"] }).notNull(),
    startLocal: text("start_local"),
    endLocal: text("end_local"),
    tz: text("tz").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekday] })],
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
