import {
  MINUTE,
  addDays,
  calendarDateFor,
  isoWeekday,
  minutesIntoGamingDay,
  zonedToUtc,
  type IsoWeekday,
  type LocalDate,
  type WallTime,
} from "./time.ts";

export type Status = "yes" | "maybe" | "no";

export type AvailabilityAnswer = {
  status: Status;
  startLocal: WallTime | null;
  endLocal: WallTime | null;
  tz: string;
};

/** A day can have several time slots (each Yes or Maybe), or a single "no". */
export type WeeklyDefaults = Partial<Record<IsoWeekday, AvailabilityAnswer[]>>;

export type EffectiveAvailability =
  | { kind: "unknown" }
  | {
      kind: "explicit" | "default";
      /** The day as a whole: yes if any slot is yes, else maybe, else no. */
      status: Status;
      /** Yes/Maybe slots, earliest first. Empty for "no". */
      slots: AvailabilityAnswer[];
    };

/** Yes if any answer is yes, else maybe if any is maybe, else no. */
export function dayStatus(answers: readonly { status: Status }[]): Status {
  if (answers.some((a) => a.status === "yes")) return "yes";
  if (answers.some((a) => a.status === "maybe")) return "maybe";
  return "no";
}

/** Orders slots by start time within the gaming day (so 00:30 comes after 23:00). */
export function sortSlots<T extends { startLocal: WallTime | null }>(slots: readonly T[]): T[] {
  const key = (s: T) => (s.startLocal ? minutesIntoGamingDay(s.startLocal) : -1);
  return [...slots].sort((a, b) => key(a) - key(b));
}

/** Explicit answers for the day, else the weekly default for that weekday, else unknown (§4.2). */
export function resolveEffective(
  day: LocalDate,
  explicit: readonly AvailabilityAnswer[],
  defaults: WeeklyDefaults,
): EffectiveAvailability {
  const pick = (kind: "explicit" | "default", answers: readonly AvailabilityAnswer[]) => ({
    kind,
    status: dayStatus(answers),
    slots: sortSlots(answers.filter((a) => a.status !== "no")),
  });
  if (explicit.length > 0) return pick("explicit", explicit);
  const fallback = defaults[isoWeekday(day)];
  if (fallback && fallback.length > 0) return pick("default", fallback);
  return { kind: "unknown" };
}

export type Interval = { start: number; end: number };

/**
 * The UTC interval an answer covers on a gaming day. Null for "no" or when there's no start time.
 * Without an end time the user's default session length is used; an end at or before the start
 * means the session runs past midnight.
 */
export function answerInterval(
  day: LocalDate,
  answer: AvailabilityAnswer,
  defaultSessionMinutes: number,
): Interval | null {
  if (answer.status === "no" || !answer.startLocal) return null;

  const startDate = calendarDateFor(day, answer.startLocal);
  const start = zonedToUtc(startDate, answer.startLocal, answer.tz);
  if (!answer.endLocal || answer.endLocal === answer.startLocal) {
    return { start, end: start + defaultSessionMinutes * MINUTE };
  }
  const endDate = answer.endLocal < answer.startLocal ? addDays(startDate, 1) : startDate;
  return { start, end: zonedToUtc(endDate, answer.endLocal, answer.tz) };
}
