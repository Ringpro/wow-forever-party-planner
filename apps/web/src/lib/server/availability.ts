// Availability use cases: the user's own days (with several time slots), weekly defaults,
// free-now status, and a group's week.
import { schema, type Db } from "@muster/db";
import {
  addDays,
  addMinutesInGamingDay,
  HOUR,
  answerInterval,
  dayIntervals,
  bestStart,
  dayStatus,
  gamingDay,
  isValidLocalDate,
  isValidWallTime,
  isoWeekday,
  minutesIntoGamingDay,
  resolveEffective,
  sortSlots,
  visibleInGroup,
  type AvailabilityAnswer,
  type BestStart,
  type EffectiveAvailability,
  type IsoWeekday,
  type LocalDate,
  type MemberInterval,
  type Status,
  type WallTime,
  type WeeklyDefaults,
} from "@muster/domain";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { mainCharacters, type MainCharacter } from "./characters.ts";
import { getGroupAsMember, type Group, type Membership } from "./groups.ts";
import type { SessionUser } from "./session.ts";
import { UserError } from "./users.ts";

const MAX_DAYS_AHEAD = 60;
const MAX_SLOTS = 4;
const DOUBLE_TAP_MS = 5_000;
const NEW_SLOT_START: WallTime = "12:00";
/** Start time used when someone says Yes/Maybe without picking one. */
export const USUAL_START: WallTime = "20:30";

export type Entry = typeof schema.availabilityEntries.$inferSelect;
export type Source = Entry["source"];
/** One Yes/Maybe time slot as the user enters it. */
export type SlotInput = { status: "yes" | "maybe"; startLocal: WallTime; endLocal: WallTime | null };

/** The next `count` gaming days starting today in `tz`. */
export function upcomingDays(tz: string, count = 7): LocalDate[] {
  const today = gamingDay(Date.now(), tz);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

export type PlanningWeek = { key: "this" | "next"; monday: LocalDate; days: LocalDate[] };

function mondayOf(day: LocalDate): LocalDate {
  return addDays(day, 1 - isoWeekday(day));
}

/** The rest of this week (from today) and all of next week, Monday to Sunday. */
export function planningWeeks(tz: string): PlanningWeek[] {
  const today = gamingDay(Date.now(), tz);
  const monday = mondayOf(today);
  const nextMonday = addDays(monday, 7);
  return [
    { key: "this", monday, days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d >= today) },
    { key: "next", monday: nextMonday, days: Array.from({ length: 7 }, (_, i) => addDays(nextMonday, i)) },
  ];
}

export function planningDays(tz: string): LocalDate[] {
  return planningWeeks(tz).flatMap((w) => w.days);
}

// ── Validation ───────────────────────────────────────────────────────────────────────────

function requireTimezone(user: SessionUser): string {
  if (!user.timezone) throw new UserError("Pick your time zone first.");
  return user.timezone;
}

function requireEditableDay(user: SessionUser, day: string): LocalDate {
  const today = gamingDay(Date.now(), requireTimezone(user));
  if (!isValidLocalDate(day) || day < today || day > addDays(today, MAX_DAYS_AHEAD)) {
    throw new UserError("That day can't be changed.");
  }
  return day;
}

function slotInput(input: { status: string; startLocal: string | null; endLocal: string | null }): SlotInput {
  if (input.status !== "yes" && input.status !== "maybe") throw new UserError("Pick Yes or Maybe.");
  if (!input.startLocal || !isValidWallTime(input.startLocal)) throw new UserError("Pick a start time.");
  if (input.endLocal && !isValidWallTime(input.endLocal)) throw new UserError("That end time isn't valid.");
  return { status: input.status, startLocal: input.startLocal, endLocal: input.endLocal || null };
}

function checkSlots(slots: readonly SlotInput[]): SlotInput[] {
  if (slots.length > MAX_SLOTS) throw new UserError(`A day can have up to ${MAX_SLOTS} times.`);
  return sortSlots(slots);
}

// ── Your days ────────────────────────────────────────────────────────────────────────────

/** Replaces everything for a day: either "no", or a list of Yes/Maybe slots. */
async function writeDay(
  db: Db,
  user: SessionUser,
  day: LocalDate,
  answer: "no" | readonly SlotInput[],
  source: Source,
  extra: { lastRelativeShiftAt?: number } = {},
): Promise<void> {
  const tz = requireTimezone(user);
  const rows =
    answer === "no"
      ? [{ status: "no" as const, startLocal: null, endLocal: null }]
      : checkSlots(answer).map((s) => ({ status: s.status, startLocal: s.startLocal, endLocal: s.endLocal }));
  const now = Date.now();
  const intervals = dayIntervals(day, rows.map((row) => ({ ...row, tz })));
  const inserts = rows.map((row, slot) => {
    const interval = intervals[slot];
    return db.insert(schema.availabilityEntries).values({
      id: crypto.randomUUID(),
      userId: user.id,
      localDate: day,
      slot,
      ...row,
      tz,
      startsAt: interval?.start ?? null,
      endsAt: interval?.end ?? null,
      source,
      lastRelativeShiftAt: extra.lastRelativeShiftAt ?? null,
      updatedAt: now,
    });
  });
  await db.batch([
    db
      .delete(schema.availabilityEntries)
      .where(and(eq(schema.availabilityEntries.userId, user.id), eq(schema.availabilityEntries.localDate, day))),
    ...inserts,
  ]);
}

/** Sets a whole day to a single answer: one Yes/Maybe slot, or No. */
export async function setAvailability(
  db: Db,
  user: SessionUser,
  input: { day: string; status: string; startLocal: string | null; endLocal: string | null },
  source: Source,
): Promise<void> {
  const day = requireEditableDay(user, input.day);
  if (input.status === "no") return writeDay(db, user, day, "no", source);
  await writeDay(db, user, day, [slotInput(input)], source);
}

export async function clearAvailability(db: Db, userId: string, day: string): Promise<void> {
  await db
    .delete(schema.availabilityEntries)
    .where(and(eq(schema.availabilityEntries.userId, userId), eq(schema.availabilityEntries.localDate, day)));
}

/** The day's current slots, taking the weekly default when there's no explicit answer. */
async function currentSlots(db: Db, user: SessionUser, day: LocalDate): Promise<SlotInput[]> {
  const current = (await myDays(db, user.id, [day])).get(day)!;
  if (current.kind === "unknown") return [];
  return current.slots.map((s) => ({ status: s.status as "yes" | "maybe", startLocal: s.startLocal!, endLocal: s.endLocal }));
}

/**
 * Changes one slot of a day (by its position, earliest first) or adds it when the index is past
 * the end. A day that came from the weekly default is copied first, so other slots stay.
 */
export async function setSlot(
  db: Db,
  user: SessionUser,
  dayInput: string,
  index: number,
  input: { status: string; startLocal: string | null; endLocal: string | null },
  source: Source,
): Promise<void> {
  const day = requireEditableDay(user, dayInput);
  if (input.status === "no") return writeDay(db, user, day, "no", source);
  const slots = await currentSlots(db, user, day);
  const slot = slotInput(input);
  if (Number.isInteger(index) && index >= 0 && index < slots.length) slots[index] = slot;
  else slots.push(slot);
  await writeDay(db, user, day, slots, source);
}

/**
 * Adds another slot to a day, starting an hour after the last one ends unless a start is given.
 * Adding a start time the day already has just changes that slot's status.
 */
export async function addSlot(
  db: Db,
  user: SessionUser,
  dayInput: string,
  source: Source,
  startLocal?: WallTime,
  status: "yes" | "maybe" = "yes",
): Promise<void> {
  const day = requireEditableDay(user, dayInput);
  const slots = await currentSlots(db, user, day);
  const same = startLocal ? slots.find((s) => s.startLocal === startLocal) : undefined;
  if (same) {
    same.status = status;
    return writeDay(db, user, day, slots, source);
  }
  if (slots.length >= MAX_SLOTS) throw new UserError(`A day can have up to ${MAX_SLOTS} times.`);
  let start = startLocal ?? NEW_SLOT_START;
  if (!startLocal && slots.length > 0) {
    const last = slots[slots.length - 1]!;
    const lastEnd = last.endLocal ?? addMinutesInGamingDay(last.startLocal, user.defaultSessionMinutes);
    start = (lastEnd && addMinutesInGamingDay(lastEnd, 60)) ?? NEW_SLOT_START;
  }
  slots.push({ status, startLocal: start, endLocal: null });
  await writeDay(db, user, day, slots, source);
}

/** The status the day's quick toggle moves to next: Yes → Maybe → No → not set → Yes. */
export function nextStatus(current: Status | "unknown"): Status | "unknown" {
  const order = ["yes", "maybe", "no", "unknown"] as const;
  return order[(order.indexOf(current) + 1) % order.length]!;
}

/**
 * Sets a day's overall answer from the quick toggle. Yes/Maybe keeps the day's times (or uses
 * the usual start when it has none), No replaces them, "unknown" clears the day back to the default.
 */
export async function setDayStatus(
  db: Db,
  user: SessionUser,
  dayInput: string,
  status: string,
  source: Source,
): Promise<void> {
  const day = requireEditableDay(user, dayInput);
  if (status === "unknown") return clearAvailability(db, user.id, day);
  if (status === "no") return writeDay(db, user, day, "no", source);
  if (status !== "yes" && status !== "maybe") throw new UserError("Pick Yes, Maybe or No.");
  const playing: "yes" | "maybe" = status;
  const slots = await currentSlots(db, user, day);
  const next = slots.length > 0 ? slots.map((s) => ({ ...s, status: playing })) : [{ status: playing, startLocal: USUAL_START, endLocal: null }];
  await writeDay(db, user, day, next, source);
}

/** Removes one slot. Removing the only explicit slot clears the day (back to the default). */
export async function removeSlot(db: Db, user: SessionUser, dayInput: string, index: number, source: Source) {
  const day = requireEditableDay(user, dayInput);
  const slots = await currentSlots(db, user, day);
  slots.splice(index, 1);
  if (slots.length === 0) return clearAvailability(db, user.id, day);
  await writeDay(db, user, day, slots, source);
}

/** Explicit rows per day, earliest slot first. */
export async function myEntries(db: Db, userId: string, days: LocalDate[]): Promise<Map<LocalDate, Entry[]>> {
  const rows = await db
    .select()
    .from(schema.availabilityEntries)
    .where(and(eq(schema.availabilityEntries.userId, userId), inArray(schema.availabilityEntries.localDate, days)));
  const byDay = new Map<LocalDate, Entry[]>();
  for (const row of rows.sort((a, b) => a.slot - b.slot)) byDay.set(row.localDate, [...(byDay.get(row.localDate) ?? []), row]);
  return byDay;
}

const answerOf = (e: { status: Status; startLocal: string | null; endLocal: string | null; tz: string }): AvailabilityAnswer => ({
  status: e.status,
  startLocal: e.startLocal,
  endLocal: e.endLocal,
  tz: e.tz,
});

export type MyDay = EffectiveAvailability & { entries: Entry[] };

/** The user's own days: explicit answers, else weekly default, else unknown. */
export async function myDays(db: Db, userId: string, days: LocalDate[]): Promise<Map<LocalDate, MyDay>> {
  const [entries, defaults] = await Promise.all([myEntries(db, userId, days), getWeeklyDefaults(db, userId)]);
  return new Map(
    days.map((day) => {
      const rows = entries.get(day) ?? [];
      return [day, { ...resolveEffective(day, rows.map(answerOf), defaults), entries: rows }];
    }),
  );
}

/**
 * Copies this week's explicit answers (Monday to Sunday, including days already past) to the same
 * weekdays next week, without touching days that already have an explicit answer. Days limited to
 * selected groups aren't copied, so a copy can never be shared more widely than the original.
 * Returns how many days were copied.
 */
export async function copyWeekForward(db: Db, user: SessionUser): Promise<number> {
  const monday = mondayOf(gamingDay(Date.now(), requireTimezone(user)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const targets = days.map((d) => addDays(d, 7));
  const [current, next] = await Promise.all([myEntries(db, user.id, days), myEntries(db, user.id, targets)]);
  let copied = 0;
  for (const day of days) {
    const rows = current.get(day);
    const target = addDays(day, 7);
    if (!rows || rows.some((r) => r.shareScope !== "all_shared_groups") || next.has(target)) continue;
    const answer =
      dayStatus(rows) === "no"
        ? "no"
        : rows
            .filter((r) => r.status !== "no" && r.startLocal)
            .map((r) => ({ status: r.status as "yes" | "maybe", startLocal: r.startLocal!, endLocal: r.endLocal }));
    await writeDay(db, user, target, answer, rows[0]!.source);
    copied++;
  }
  return copied;
}

/**
 * Makes this week's explicit answers (Monday to Sunday) the user's weekly defaults, one weekday at
 * a time. Weekdays without an answer keep their default. Days limited to selected groups are
 * skipped, because defaults are shared with every group. Returns how many weekdays were saved.
 */
export async function saveWeekAsDefaults(db: Db, user: SessionUser): Promise<number> {
  const monday = mondayOf(gamingDay(Date.now(), requireTimezone(user)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const current = await myEntries(db, user.id, days);
  let saved = 0;
  for (const day of days) {
    const rows = current.get(day);
    if (!rows || rows.some((r) => r.shareScope !== "all_shared_groups")) continue;
    const answer =
      dayStatus(rows) === "no"
        ? "no"
        : rows
            .filter((r) => r.status !== "no" && r.startLocal)
            .map((r) => ({ status: r.status as "yes" | "maybe", startLocal: r.startLocal!, endLocal: r.endLocal }));
    await writeDefault(db, user, isoWeekday(day), answer);
    saved++;
  }
  return saved;
}

export async function hasWeeklyDefaults(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .select({ userId: schema.weeklyDefaults.userId })
    .from(schema.weeklyDefaults)
    .where(eq(schema.weeklyDefaults.userId, userId))
    .get();
  return row !== undefined;
}

/** The Monday after `day`'s week. */
export const nextMondayAfter = (day: LocalDate): LocalDate => addDays(mondayOf(day), 7);

export type NextWeekNudge = {
  group: Group;
  monday: LocalDate;
  /** Members who share with the group, by the name they go by there. */
  members: { userId: string; displayName: string }[];
  /** Those with nothing for next week: no answer on any day and no weekly defaults. */
  waiting: { userId: string; displayName: string }[];
};

/** Who in a group hasn't said anything about next week yet, for the Sunday reminder. */
export async function nextWeekNudge(db: Db, groupId: string): Promise<NextWeekNudge | null> {
  const group = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get();
  if (!group) return null;
  const monday = nextMondayAfter(gamingDay(Date.now(), group.timezone));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // One day is enough here: it brings the member names, with server nicknames applied.
  const view = await loadWeek(db, group, [monday]);
  const sharing = await db
    .select({ userId: schema.groupMemberships.userId })
    .from(schema.groupMemberships)
    .where(and(eq(schema.groupMemberships.groupId, groupId), eq(schema.groupMemberships.shareAvailability, true)));
  const ids = sharing.map((s) => s.userId);
  const members = view.members.filter((m) => ids.includes(m.userId)).map(({ userId, displayName }) => ({ userId, displayName }));
  if (ids.length === 0) return { group, monday, members, waiting: [] };
  const [answered, withDefaults] = await Promise.all([
    db
      .selectDistinct({ userId: schema.availabilityEntries.userId })
      .from(schema.availabilityEntries)
      .where(and(inArray(schema.availabilityEntries.userId, ids), inArray(schema.availabilityEntries.localDate, days))),
    db
      .selectDistinct({ userId: schema.weeklyDefaults.userId })
      .from(schema.weeklyDefaults)
      .where(inArray(schema.weeklyDefaults.userId, ids)),
  ]);
  const planned = new Set([...answered, ...withDefaults].map((r) => r.userId));
  return { group, monday, members, waiting: members.filter((m) => !planned.has(m.userId)) };
}

// ── Weekly defaults (PRD M4) ─────────────────────────────────────────────────────────────

const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

function requireWeekday(weekday: number): IsoWeekday {
  const day = WEEKDAYS.find((w) => w === weekday);
  if (!day) throw new UserError("Unknown weekday.");
  return day;
}

async function defaultsFor(db: Db, userIds: string[]): Promise<Map<string, WeeklyDefaults>> {
  const byUser = new Map<string, WeeklyDefaults>();
  if (userIds.length === 0) return byUser;
  const rows = await db.select().from(schema.weeklyDefaults).where(inArray(schema.weeklyDefaults.userId, userIds));
  for (const r of rows.sort((a, b) => a.slot - b.slot)) {
    const defaults = byUser.get(r.userId) ?? {};
    const weekday = r.weekday as IsoWeekday;
    defaults[weekday] = [...(defaults[weekday] ?? []), answerOf(r)];
    byUser.set(r.userId, defaults);
  }
  return byUser;
}

export async function getWeeklyDefaults(db: Db, userId: string): Promise<WeeklyDefaults> {
  return (await defaultsFor(db, [userId])).get(userId) ?? {};
}

async function writeDefault(db: Db, user: SessionUser, weekday: IsoWeekday, answer: "no" | readonly SlotInput[]) {
  const tz = requireTimezone(user);
  const rows =
    answer === "no"
      ? [{ status: "no" as const, startLocal: null, endLocal: null }]
      : checkSlots(answer).map((s) => ({ status: s.status, startLocal: s.startLocal, endLocal: s.endLocal }));
  await db.batch([
    db
      .delete(schema.weeklyDefaults)
      .where(and(eq(schema.weeklyDefaults.userId, user.id), eq(schema.weeklyDefaults.weekday, weekday))),
    ...rows.map((row, slot) =>
      db.insert(schema.weeklyDefaults).values({ userId: user.id, weekday, slot, ...row, tz, updatedAt: Date.now() }),
    ),
  ]);
}

async function currentDefaultSlots(db: Db, userId: string, weekday: IsoWeekday): Promise<SlotInput[]> {
  const answers = (await getWeeklyDefaults(db, userId))[weekday] ?? [];
  return sortSlots(answers.filter((a) => a.status !== "no" && a.startLocal)).map((a) => ({
    status: a.status as "yes" | "maybe",
    startLocal: a.startLocal!,
    endLocal: a.endLocal,
  }));
}

/** Sets a weekday's default to a single answer: one Yes/Maybe slot, or No. */
export async function setWeeklyDefault(
  db: Db,
  user: SessionUser,
  weekday: number,
  input: { status: string; startLocal: string | null; endLocal: string | null },
): Promise<void> {
  const day = requireWeekday(weekday);
  if (input.status === "no") return writeDefault(db, user, day, "no");
  await writeDefault(db, user, day, [slotInput(input)]);
}

/** Changes (or adds, past the end) one slot of a weekday's default. */
export async function setDefaultSlot(
  db: Db,
  user: SessionUser,
  weekday: number,
  index: number,
  input: { status: string; startLocal: string | null; endLocal: string | null },
): Promise<void> {
  const day = requireWeekday(weekday);
  if (input.status === "no") return writeDefault(db, user, day, "no");
  const slots = await currentDefaultSlots(db, user.id, day);
  const slot = slotInput(input);
  if (Number.isInteger(index) && index >= 0 && index < slots.length) slots[index] = slot;
  else slots.push(slot);
  await writeDefault(db, user, day, slots);
}

/** The quick toggle for a weekday default; works like setDayStatus. */
export async function setDefaultStatus(db: Db, user: SessionUser, weekday: number, status: string): Promise<void> {
  const day = requireWeekday(weekday);
  if (status === "unknown") return clearWeeklyDefault(db, user.id, day);
  if (status === "no") return writeDefault(db, user, day, "no");
  if (status !== "yes" && status !== "maybe") throw new UserError("Pick Yes, Maybe or No.");
  const playing: "yes" | "maybe" = status;
  const slots = await currentDefaultSlots(db, user.id, day);
  const next = slots.length > 0 ? slots.map((s) => ({ ...s, status: playing })) : [{ status: playing, startLocal: USUAL_START, endLocal: null }];
  await writeDefault(db, user, day, next);
}

export async function addDefaultSlot(db: Db, user: SessionUser, weekday: number): Promise<void> {
  const day = requireWeekday(weekday);
  const slots = await currentDefaultSlots(db, user.id, day);
  if (slots.length >= MAX_SLOTS) throw new UserError(`A day can have up to ${MAX_SLOTS} times.`);
  const last = slots[slots.length - 1];
  const lastEnd = last && (last.endLocal ?? addMinutesInGamingDay(last.startLocal, user.defaultSessionMinutes));
  const start = (lastEnd && addMinutesInGamingDay(lastEnd, 60)) ?? NEW_SLOT_START;
  await writeDefault(db, user, day, [...slots, { status: "yes", startLocal: start, endLocal: null }]);
}

export async function removeDefaultSlot(db: Db, user: SessionUser, weekday: number, index: number): Promise<void> {
  const day = requireWeekday(weekday);
  const slots = await currentDefaultSlots(db, user.id, day);
  slots.splice(index, 1);
  if (slots.length === 0) return clearWeeklyDefault(db, user.id, day);
  await writeDefault(db, user, day, slots);
}

export async function clearWeeklyDefault(db: Db, userId: string, weekday: number): Promise<void> {
  await db
    .delete(schema.weeklyDefaults)
    .where(and(eq(schema.weeklyDefaults.userId, userId), eq(schema.weeklyDefaults.weekday, weekday)));
}

// ── Running late ─────────────────────────────────────────────────────────────────────────

export type ShiftResult = {
  day: LocalDate;
  slot: number;
  from: WallTime;
  to: WallTime;
  status: "yes" | "maybe";
  ignored: boolean;
};

/**
 * Moves the start of one Yes/Maybe slot on `day` (explicit or from the weekly default) to `to`,
 * keeping its status. Drops its end time if the new start would be at or after it.
 */
export async function moveStart(
  db: Db,
  user: SessionUser,
  dayInput: LocalDate,
  index: number,
  to: WallTime,
  source: Source,
  extra: { lastRelativeShiftAt?: number } = {},
): Promise<ShiftResult> {
  const day = requireEditableDay(user, dayInput);
  const slots = await currentSlots(db, user, day);
  const slot = slots[index];
  if (!slot) throw new UserError("You haven't said you're playing that day yet. Use Plan my week first.");
  const endLocal = slot.endLocal && minutesIntoGamingDay(slot.endLocal) > minutesIntoGamingDay(to) ? slot.endLocal : null;
  slots[index] = { ...slot, startLocal: to, endLocal };
  await writeDay(db, user, day, slots, source, extra);
  const moved = sortSlots(slots).indexOf(slots[index]!);
  return { day, slot: moved, from: slot.startLocal, to, status: slot.status, ignored: false };
}

/**
 * Relative shift for "+30 min" and `/delay` on today's gaming day (architecture §6.3). Applies to
 * the slot you're in or the next one coming up. A second relative shift within 5 seconds is a
 * double tap and ignored.
 */
export async function shiftToday(db: Db, user: SessionUser, minutes: number, source: Source): Promise<ShiftResult> {
  const tz = requireTimezone(user);
  const now = Date.now();
  const day = gamingDay(now, tz);
  const current = (await myDays(db, user.id, [day])).get(day)!;
  if (current.kind === "unknown" || current.slots.length === 0) {
    throw new UserError("You haven't said you're playing today yet. Use Plan my week first.");
  }
  // The slot you're in, else the next one coming up, else the last one. A slot "until late" only
  // counts as the one you're in for its first hour: otherwise an open midday slot would swallow
  // the evening.
  const windows = current.slots.map((s) => {
    const i = answerInterval(day, s);
    return i && isOpenEnd(s) ? { start: i.start, end: i.start + HOUR } : i;
  });
  const inside = windows.findIndex((w) => w !== null && w.start <= now && now < w.end);
  const upcoming = windows.findIndex((w) => w !== null && w.start > now);
  const index = inside !== -1 ? inside : upcoming !== -1 ? upcoming : current.slots.length - 1;
  const slot = current.slots[index]!;
  const lastShift = Math.max(0, ...current.entries.map((e) => e.lastRelativeShiftAt ?? 0));
  if (now - lastShift < DOUBLE_TAP_MS) {
    return { day, slot: index, from: slot.startLocal!, to: slot.startLocal!, status: slot.status as "yes" | "maybe", ignored: true };
  }
  const target = addMinutesInGamingDay(slot.startLocal!, minutes);
  if (!target) throw new UserError("That's past the end of the evening.");
  return moveStart(db, user, day, index, target, source, { lastRelativeShiftAt: now });
}

// ── Free now ─────────────────────────────────────────────────────────────────────────────

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
  return [...new Set(rows.map((r) => r.name))].sort();
}

// ── Group week ───────────────────────────────────────────────────────────────────────────

/**
 * One Yes/Maybe time. An answer without an end time ("until late") runs until their next slot or
 * the end of the night for the overlap maths; `openEnd` says to show it as "late".
 */
export type MemberSlot = { status: "yes" | "maybe"; startsAt: number; endsAt: number; openEnd: boolean };

const isOpenEnd = (s: { startLocal: string | null; endLocal: string | null }) => !s.endLocal || s.endLocal === s.startLocal;

export type GroupMemberDay = {
  userId: string;
  displayName: string;
  /** The day as a whole. "unknown" covers both unanswered and hidden, on purpose (architecture §4.2). */
  status: Status | "unknown";
  /** Whether the answer came from the member or from their weekly default. */
  kind: "explicit" | "default" | null;
  /** Yes/Maybe time slots, earliest first. */
  slots: MemberSlot[];
  /** Start and end of the first slot, for compact views. */
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
  /** Main characters of members who share with this group. */
  characters: Map<string, MainCharacter>;
};

export type GroupWeek = WeekView & { membership: Membership };

/** A group's week as the acting member is allowed to see it. Null if the actor isn't a member. */
export async function groupWeek(
  db: Db,
  actor: SessionUser,
  groupId: string,
  days?: LocalDate[],
): Promise<GroupWeek | null> {
  const access = await getGroupAsMember(db, actor.id, groupId);
  if (!access) return null;
  const view = await loadWeek(db, access.group, days ?? upcomingDays(actor.timezone ?? access.group.timezone));
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

  // In a Discord server and its squads, people go by their nickname there, like in Discord.
  const serverGroupId = group.parentGroupId ?? (group.discordGuildId ? group.id : null);
  if (serverGroupId) {
    const nicknames = await db
      .select({ userId: schema.groupMemberships.userId, nickname: schema.groupMemberships.nickname })
      .from(schema.groupMemberships)
      .where(and(eq(schema.groupMemberships.groupId, serverGroupId), isNotNull(schema.groupMemberships.nickname)));
    const nickOf = new Map(nicknames.map((n) => [n.userId, n.nickname!]));
    for (const m of members) m.displayName = nickOf.get(m.userId) ?? m.displayName;
  }
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

  const byKey = new Map<string, Entry[]>();
  for (const e of entries) byKey.set(`${e.userId}|${e.localDate}`, [...(byKey.get(`${e.userId}|${e.localDate}`) ?? []), e]);
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

  const characters = await mainCharacters(db, sharingIds);

  return {
    group,
    members: members.map(({ userId, displayName, role }) => ({ userId, displayName, role })),
    freeNow,
    characters,
    days: days.map((day) => {
      const rows: GroupMemberDay[] = members.map((m) => {
        const hidden: GroupMemberDay = {
          userId: m.userId,
          displayName: m.displayName,
          status: "unknown",
          kind: null,
          slots: [],
          startsAt: null,
          endsAt: null,
          updatedAt: null,
        };
        const membership = { groupId, shareAvailability: m.shareAvailability };
        const explicit = byKey.get(`${m.userId}|${day}`);
        if (explicit) {
          // Explicit answers always win over the default, even when hidden from this group.
          const visible = explicit.filter((e) =>
            visibleInGroup(
              groupId,
              membership,
              e.shareScope === "selected"
                ? { shareScope: "selected", groupIds: selectedGroups.get(e.id) ?? [] }
                : { shareScope: "all_shared_groups" },
            ),
          );
          if (visible.length === 0) return hidden;
          // Worked out from the answers, not the stored times, so rule changes apply to old answers too.
          const playing = visible.filter((e) => e.status !== "no");
          const intervals = dayIntervals(day, playing.map(answerOf));
          const slots = playing
            .flatMap((e, i) => {
              const interval = intervals[i];
              return interval
                ? [{ status: e.status as "yes" | "maybe", startsAt: interval.start, endsAt: interval.end, openEnd: isOpenEnd(e) }]
                : [];
            })
            .sort((a, b) => a.startsAt - b.startsAt);
          return {
            ...hidden,
            status: dayStatus(visible),
            kind: "explicit",
            slots,
            startsAt: slots[0]?.startsAt ?? null,
            endsAt: slots[0]?.endsAt ?? null,
            updatedAt: Math.max(...visible.map((e) => e.updatedAt)),
          };
        }
        const fallback = resolveEffective(day, [], defaults.get(m.userId) ?? {});
        if (fallback.kind === "unknown" || !visibleInGroup(groupId, membership, null)) return hidden;
        const intervals = dayIntervals(day, fallback.slots);
        const slots = fallback.slots.flatMap((s, i) => {
          const interval = intervals[i];
          return interval
            ? [{ status: s.status as "yes" | "maybe", startsAt: interval.start, endsAt: interval.end, openEnd: isOpenEnd(s) }]
            : [];
        });
        return {
          ...hidden,
          status: fallback.status,
          kind: "default",
          slots,
          startsAt: slots[0]?.startsAt ?? null,
          endsAt: slots[0]?.endsAt ?? null,
        };
      });

      const counts = { yes: 0, maybe: 0, no: 0, unknown: 0 };
      for (const r of rows) counts[r.status]++;

      const intervals: MemberInterval[] = rows.flatMap((r) =>
        r.slots.map((s) => ({ memberId: r.userId, status: s.status, interval: { start: s.startsAt, end: s.endsAt } })),
      );
      const best = bestStart(intervals, { minPlayers: group.minPlayers, minOverlapMinutes: group.minOverlapMinutes });
      return { day, members: rows, counts, best };
    }),
  };
}
