// Availability use cases: the user's own week, and a group's week as seen by a member.
import { schema, type Db } from "@party/db";
import {
  addDays,
  answerInterval,
  bestStart,
  gamingDay,
  isValidLocalDate,
  isValidWallTime,
  visibleInGroup,
  type BestStart,
  type LocalDate,
  type MemberInterval,
  type Status,
  type WallTime,
} from "@party/domain";
import { and, eq, inArray } from "drizzle-orm";
import { getGroupAsMember, type Group, type Membership } from "./groups.ts";
import type { SessionUser } from "./session.ts";
import { UserError } from "./users.ts";

const STATUSES: readonly Status[] = ["yes", "maybe", "no"];
const MAX_DAYS_AHEAD = 60;

export type Entry = typeof schema.availabilityEntries.$inferSelect;

/** The next `count` gaming days starting today in `tz`. */
export function upcomingDays(tz: string, count = 7): LocalDate[] {
  const today = gamingDay(Date.now(), tz);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

export async function setAvailability(
  db: Db,
  user: SessionUser,
  input: { day: string; status: string; startLocal: string | null; endLocal: string | null },
): Promise<void> {
  if (!user.timezone) throw new UserError("Pick your time zone first.");
  const status = STATUSES.find((s) => s === input.status);
  if (!status) throw new UserError("Pick Yes, Maybe or No.");
  const today = gamingDay(Date.now(), user.timezone);
  if (!isValidLocalDate(input.day) || input.day < today || input.day > addDays(today, MAX_DAYS_AHEAD)) {
    throw new UserError("That day can't be changed.");
  }

  let startLocal: WallTime | null = null;
  let endLocal: WallTime | null = null;
  if (status !== "no") {
    if (!input.startLocal || !isValidWallTime(input.startLocal)) throw new UserError("Pick a start time.");
    if (input.endLocal && !isValidWallTime(input.endLocal)) throw new UserError("That end time isn't valid.");
    startLocal = input.startLocal;
    endLocal = input.endLocal || null;
  }

  const interval = answerInterval(input.day, { status, startLocal, endLocal, tz: user.timezone }, user.defaultSessionMinutes);
  const values = {
    status,
    startLocal,
    endLocal,
    tz: user.timezone,
    startsAt: interval?.start ?? null,
    endsAt: interval?.end ?? null,
    source: "web" as const,
    updatedAt: Date.now(),
  };
  await db
    .insert(schema.availabilityEntries)
    .values({ id: crypto.randomUUID(), userId: user.id, localDate: input.day, ...values })
    .onConflictDoUpdate({
      target: [schema.availabilityEntries.userId, schema.availabilityEntries.localDate],
      set: values,
    });
}

export async function clearAvailability(db: Db, userId: string, day: string): Promise<void> {
  await db
    .delete(schema.availabilityEntries)
    .where(and(eq(schema.availabilityEntries.userId, userId), eq(schema.availabilityEntries.localDate, day)));
}

export async function myEntries(db: Db, userId: string, days: LocalDate[]): Promise<Map<LocalDate, Entry>> {
  const rows = await db
    .select()
    .from(schema.availabilityEntries)
    .where(and(eq(schema.availabilityEntries.userId, userId), inArray(schema.availabilityEntries.localDate, days)));
  return new Map(rows.map((r) => [r.localDate, r]));
}

export type GroupMemberDay = {
  userId: string;
  displayName: string;
  /** "unknown" covers both unanswered and hidden, on purpose (architecture §4.2). */
  status: Status | "unknown";
  startsAt: number | null;
  endsAt: number | null;
  updatedAt: number | null;
};

export type GroupDay = {
  day: LocalDate;
  members: GroupMemberDay[];
  counts: Record<Status | "unknown", number>;
  best: BestStart | null;
};

export type GroupWeek = {
  group: Group;
  membership: Membership;
  members: { userId: string; displayName: string; role: "admin" | "member" }[];
  days: GroupDay[];
};

/** A group's week as the acting member is allowed to see it. Null if the actor isn't a member. */
export async function groupWeek(db: Db, actor: SessionUser, groupId: string): Promise<GroupWeek | null> {
  const access = await getGroupAsMember(db, actor.id, groupId);
  if (!access) return null;
  const { group } = access;

  const members = await db
    .select({
      userId: schema.users.id,
      displayName: schema.users.displayName,
      role: schema.groupMemberships.role,
      shareAvailability: schema.groupMemberships.shareAvailability,
    })
    .from(schema.groupMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMemberships.userId))
    .where(eq(schema.groupMemberships.groupId, groupId));
  members.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const days = upcomingDays(actor.timezone ?? group.timezone);
  const memberIds = members.map((m) => m.userId);
  const entries = await db
    .select()
    .from(schema.availabilityEntries)
    .where(
      and(inArray(schema.availabilityEntries.userId, memberIds), inArray(schema.availabilityEntries.localDate, days)),
    );

  const selectedIds = entries.filter((e) => e.shareScope === "selected").map((e) => e.id);
  const selectedGroups = new Map<string, string[]>();
  if (selectedIds.length > 0) {
    const rows = await db
      .select()
      .from(schema.availabilityEntryGroups)
      .where(inArray(schema.availabilityEntryGroups.entryId, selectedIds));
    for (const r of rows) selectedGroups.set(r.entryId, [...(selectedGroups.get(r.entryId) ?? []), r.groupId]);
  }

  const byKey = new Map(entries.map((e) => [`${e.userId}|${e.localDate}`, e]));

  return {
    group,
    membership: access.membership,
    members: members.map(({ userId, displayName, role }) => ({ userId, displayName, role })),
    days: days.map((day) => {
      const rows: GroupMemberDay[] = members.map((m) => {
        const entry = byKey.get(`${m.userId}|${day}`);
        const visible =
          entry &&
          visibleInGroup(
            groupId,
            { groupId, shareAvailability: m.shareAvailability },
            entry.shareScope === "selected"
              ? { shareScope: "selected", groupIds: selectedGroups.get(entry.id) ?? [] }
              : { shareScope: "all_shared_groups" },
          );
        return visible
          ? {
              userId: m.userId,
              displayName: m.displayName,
              status: entry.status,
              startsAt: entry.startsAt,
              endsAt: entry.endsAt,
              updatedAt: entry.updatedAt,
            }
          : { userId: m.userId, displayName: m.displayName, status: "unknown", startsAt: null, endsAt: null, updatedAt: null };
      });

      const counts = { yes: 0, maybe: 0, no: 0, unknown: 0 };
      for (const r of rows) counts[r.status]++;

      const intervals: MemberInterval[] = rows.flatMap((r) =>
        (r.status === "yes" || r.status === "maybe") && r.startsAt !== null && r.endsAt !== null
          ? [{ memberId: r.userId, status: r.status, interval: { start: r.startsAt, end: r.endsAt } }]
          : [],
      );
      const best = bestStart(intervals, { minPlayers: group.minPlayers, minOverlapMinutes: group.minOverlapMinutes });
      return { day, members: rows, counts, best };
    }),
  };
}
