// Availability use cases: the user's own days, free-now status, and a group's week.
import { schema, type Db } from "@party/db";
import {
  addDays,
  addMinutesInGamingDay,
  answerInterval,
  bestStart,
  gamingDay,
  isValidLocalDate,
  isValidWallTime,
  minutesIntoGamingDay,
  resolveEffective,
  visibleInGroup,
  type BestStart,
  type EffectiveAvailability,
  type IsoWeekday,
  type LocalDate,
  type WeeklyDefaults,
  type MemberInterval,
  type Status,
  type WallTime,
} from "@party/domain";
import { and, eq, gt, inArray } from "drizzle-orm";
import { getGroupAsMember, type Group, type Membership } from "./groups.ts";
import type { SessionUser } from "./session.ts";
import { UserError } from "./users.ts";

const STATUSES: readonly Status[] = ["yes", "maybe", "no"];
const MAX_DAYS_AHEAD = 60;
const DOUBLE_TAP_MS = 5_000;

export type Entry = typeof schema.availabilityEntries.$inferSelect;
export type Source = Entry["source"];

/** The next `count` gaming days starting today in `tz`. */
export function upcomingDays(tz: string, count = 7): LocalDate[] {
  const today = gamingDay(Date.now(), tz);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

export async function setAvailability(
  db: Db,
  user: SessionUser,
  input: { day: string; status: string; startLocal: string | null; endLocal: string | null },
  source: Source,
  extra: { lastRelativeShiftAt?: number } = {},
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
    source,
    lastRelativeShiftAt: extra.lastRelativeShiftAt ?? null,
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

// ── Weekly defaults (PRD M4) ─────────────────────────────────────────────────────────────

const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

async function defaultsFor(db: Db, userIds: string[]): Promise<Map<string, WeeklyDefaults>> {
  const byUser = new Map<string, WeeklyDefaults>();
  if (userIds.length === 0) return byUser;
  const rows = await db.select().from(schema.weeklyDefaults).where(inArray(schema.weeklyDefaults.userId, userIds));
  for (const r of rows) {
    const defaults = byUser.get(r.userId) ?? {};
    defaults[r.weekday as IsoWeekday] = { status: r.status, startLocal: r.startLocal, endLocal: r.endLocal, tz: r.tz };
    byUser.set(r.userId, defaults);
  }
  return byUser;
}

export async function getWeeklyDefaults(db: Db, userId: string): Promise<WeeklyDefaults> {
  return (await defaultsFor(db, [userId])).get(userId) ?? {};
}

export async function setWeeklyDefault(
  db: Db,
  user: SessionUser,
  weekday: number,
  input: { status: string; startLocal: string | null; endLocal: string | null },
): Promise<void> {
  if (!user.timezone) throw new UserError("Pick your time zone first.");
  const day = WEEKDAYS.find((w) => w === weekday);
  if (!day) throw new UserError("Unknown weekday.");
  const status = STATUSES.find((s) => s === input.status);
  if (!status) throw new UserError("Pick Yes, Maybe or No.");
  let startLocal: WallTime | null = null;
  let endLocal: WallTime | null = null;
  if (status !== "no") {
    if (!input.startLocal || !isValidWallTime(input.startLocal)) throw new UserError("Pick a start time.");
    if (input.endLocal && !isValidWallTime(input.endLocal)) throw new UserError("That end time isn't valid.");
    startLocal = input.startLocal;
    endLocal = input.endLocal || null;
  }
  const values = { status, startLocal, endLocal, tz: user.timezone, updatedAt: Date.now() };
  await db
    .insert(schema.weeklyDefaults)
    .values({ userId: user.id, weekday: day, ...values })
    .onConflictDoUpdate({ target: [schema.weeklyDefaults.userId, schema.weeklyDefaults.weekday], set: values });
}

export async function clearWeeklyDefault(db: Db, userId: string, weekday: number): Promise<void> {
  await db
    .delete(schema.weeklyDefaults)
    .where(and(eq(schema.weeklyDefaults.userId, userId), eq(schema.weeklyDefaults.weekday, weekday)));
}

export type MyDay = EffectiveAvailability & { entry?: Entry };

/** The user's own days: explicit answer, else weekly default, else unknown. */
export async function myDays(db: Db, userId: string, days: LocalDate[]): Promise<Map<LocalDate, MyDay>> {
  const [entries, defaults] = await Promise.all([myEntries(db, userId, days), getWeeklyDefaults(db, userId)]);
  return new Map(
    days.map((day) => {
      const entry = entries.get(day);
      const effective = resolveEffective(day, entry && { ...entry }, defaults);
      return [day, entry ? { ...effective, entry } : effective];
    }),
  );
}

/**
 * Copies this week's explicit answers to the same weekdays next week, without touching days that
 * already have an explicit answer. Days limited to selected groups aren't copied, so a copy can
 * never be shared more widely than the original. Returns how many days were copied.
 */
export async function copyWeekForward(db: Db, user: SessionUser): Promise<number> {
  if (!user.timezone) throw new UserError("Pick your time zone first.");
  const days = upcomingDays(user.timezone);
  const targets = days.map((d) => addDays(d, 7));
  const [current, next] = await Promise.all([myEntries(db, user.id, days), myEntries(db, user.id, targets)]);
  let copied = 0;
  for (const day of days) {
    const entry = current.get(day);
    const target = addDays(day, 7);
    if (!entry || entry.shareScope !== "all_shared_groups" || next.has(target)) continue;
    await setAvailability(
      db,
      user,
      { day: target, status: entry.status, startLocal: entry.startLocal, endLocal: entry.endLocal },
      entry.source,
    );
    copied++;
  }
  return copied;
}

export type ShiftResult = { day: LocalDate; from: WallTime; to: WallTime; status: "yes" | "maybe"; ignored: boolean };

async function playingOn(db: Db, user: SessionUser, day: LocalDate, message: string) {
  const current = (await myDays(db, user.id, [day])).get(day);
  if (!current || current.kind === "unknown" || current.status === "no" || !current.startLocal) {
    throw new UserError(message);
  }
  return { ...current, status: current.status, startLocal: current.startLocal };
}

/**
 * Moves the start of a Yes/Maybe on `day` (explicit or from the weekly default) to `to`, keeping
 * the status. Drops the end time if the new start would be at or after it.
 */
export async function moveStart(
  db: Db,
  user: SessionUser,
  day: LocalDate,
  to: WallTime,
  source: Source,
  extra: { lastRelativeShiftAt?: number } = {},
): Promise<ShiftResult> {
  const current = await playingOn(db, user, day, "You haven't said you're playing that day yet. Use Plan my week first.");
  const endLocal =
    current.endLocal && minutesIntoGamingDay(current.endLocal) > minutesIntoGamingDay(to) ? current.endLocal : null;
  await setAvailability(db, user, { day, status: current.status, startLocal: to, endLocal }, source, extra);
  return { day, from: current.startLocal, to, status: current.status, ignored: false };
}

/**
 * Relative shift for "+30 min" and `/delay` on today's gaming day (architecture §6.3).
 * A second relative shift within 5 seconds is treated as a double tap and ignored.
 */
export async function shiftToday(db: Db, user: SessionUser, minutes: number, source: Source): Promise<ShiftResult> {
  if (!user.timezone) throw new UserError("Pick your time zone first.");
  const now = Date.now();
  const day = gamingDay(now, user.timezone);
  const current = await playingOn(db, user, day, "You haven't said you're playing today yet. Use Plan my week first.");
  const lastShift = current.entry?.lastRelativeShiftAt;
  if (lastShift && now - lastShift < DOUBLE_TAP_MS) {
    return { day, from: current.startLocal, to: current.startLocal, status: current.status, ignored: true };
  }
  const target = addMinutesInGamingDay(current.startLocal, minutes);
  if (!target) throw new UserError("That's past the end of the evening.");
  return moveStart(db, user, day, target, source, { lastRelativeShiftAt: now });
}

export async function setFreeNow(db: Db, userId: string, until: number): Promise<void> {
  const values = { expiresAt: until, updatedAt: Date.now() };
  await db
    .insert(schema.freeNow)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.freeNow.userId, set: values });
}

export async function clearFreeNow(db: Db, userId: string): Promise<void> {
  await db.delete(schema.freeNow).where(eq(schema.freeNow.userId, userId));
}

/** Names of the groups that can see this user's availability. */
export async function sharedGroupNames(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.groups.name })
    .from(schema.groupMemberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMemberships.groupId))
    .where(and(eq(schema.groupMemberships.userId, userId), eq(schema.groupMemberships.shareAvailability, true)));
  return rows.map((r) => r.name).sort();
}

export type GroupMemberDay = {
  userId: string;
  displayName: string;
  /** "unknown" covers both unanswered and hidden, on purpose (architecture §4.2). */
  status: Status | "unknown";
  /** Whether the answer came from the member or from their weekly default. */
  kind: "explicit" | "default" | null;
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

export type FreeNowMember = { userId: string; displayName: string; until: number };

export type WeekView = {
  group: Group;
  members: { userId: string; displayName: string; role: "admin" | "member" }[];
  days: GroupDay[];
  freeNow: FreeNowMember[];
};

export type GroupWeek = WeekView & { membership: Membership };

/** A group's week as the acting member is allowed to see it. Null if the actor isn't a member. */
export async function groupWeek(db: Db, actor: SessionUser, groupId: string): Promise<GroupWeek | null> {
  const access = await getGroupAsMember(db, actor.id, groupId);
  if (!access) return null;
  const view = await loadWeek(db, access.group, upcomingDays(actor.timezone ?? access.group.timezone));
  return { ...view, membership: access.membership };
}

/**
 * A group's week for its Discord board: the same view any member gets, in the group's time zone.
 * Callers must only use this for a board linked to this group (architecture §5.1, Board actor).
 */
export async function boardWeek(db: Db, groupId: string): Promise<WeekView | null> {
  const group = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get();
  return group ? loadWeek(db, group, upcomingDays(group.timezone)) : null;
}

async function loadWeek(db: Db, group: Group, days: LocalDate[]): Promise<WeekView> {
  const groupId = group.id;
  const members = await db
    .select({
      userId: schema.users.id,
      displayName: schema.users.displayName,
      role: schema.groupMemberships.role,
      shareAvailability: schema.groupMemberships.shareAvailability,
      defaultSessionMinutes: schema.users.defaultSessionMinutes,
    })
    .from(schema.groupMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMemberships.userId))
    .where(eq(schema.groupMemberships.groupId, groupId));
  members.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const sharingIds = members.filter((m) => m.shareAvailability).map((m) => m.userId);
  const entries =
    sharingIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.availabilityEntries)
          .where(
            and(
              inArray(schema.availabilityEntries.userId, sharingIds),
              inArray(schema.availabilityEntries.localDate, days),
            ),
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
  const defaults = await defaultsFor(db, sharingIds);

  const freeRows =
    sharingIds.length === 0
      ? []
      : await db
          .select({ userId: schema.freeNow.userId, until: schema.freeNow.expiresAt })
          .from(schema.freeNow)
          .where(and(inArray(schema.freeNow.userId, sharingIds), gt(schema.freeNow.expiresAt, Date.now())));
  const names = new Map(members.map((m) => [m.userId, m.displayName]));
  const freeNow = freeRows
    .map((r) => ({ userId: r.userId, displayName: names.get(r.userId) ?? "?", until: r.until }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    group,
    members: members.map(({ userId, displayName, role }) => ({ userId, displayName, role })),
    freeNow,
    days: days.map((day) => {
      const rows: GroupMemberDay[] = members.map((m) => {
        const hidden: GroupMemberDay = {
          userId: m.userId,
          displayName: m.displayName,
          status: "unknown",
          kind: null,
          startsAt: null,
          endsAt: null,
          updatedAt: null,
        };
        const membership = { groupId, shareAvailability: m.shareAvailability };
        const entry = byKey.get(`${m.userId}|${day}`);
        if (entry) {
          // An explicit answer always wins over the default, even when it's hidden from this group.
          const sharing =
            entry.shareScope === "selected"
              ? ({ shareScope: "selected", groupIds: selectedGroups.get(entry.id) ?? [] } as const)
              : ({ shareScope: "all_shared_groups" } as const);
          if (!visibleInGroup(groupId, membership, sharing)) return hidden;
          return {
            ...hidden,
            status: entry.status,
            kind: "explicit",
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            updatedAt: entry.updatedAt,
          };
        }
        const fallback = resolveEffective(day, undefined, defaults.get(m.userId) ?? {});
        if (fallback.kind === "unknown" || !visibleInGroup(groupId, membership, null)) return hidden;
        const interval = answerInterval(day, fallback, m.defaultSessionMinutes);
        return {
          ...hidden,
          status: fallback.status,
          kind: "default",
          startsAt: interval?.start ?? null,
          endsAt: interval?.end ?? null,
        };
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
