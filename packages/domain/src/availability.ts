import {
  MINUTE,
  addDays,
  calendarDateFor,
  isoWeekday,
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

export type WeeklyDefaults = Partial<Record<IsoWeekday, AvailabilityAnswer>>;

export type EffectiveAvailability =
  | { kind: "unknown" }
  | ({ kind: "explicit" | "default" } & AvailabilityAnswer);

/** Explicit entry for the day, else the weekly default for that weekday, else unknown (§4.2). */
export function resolveEffective(
  day: LocalDate,
  explicit: AvailabilityAnswer | undefined,
  defaults: WeeklyDefaults,
): EffectiveAvailability {
  if (explicit) return { kind: "explicit", ...explicit };
  const fallback = defaults[isoWeekday(day)];
  if (fallback) return { kind: "default", ...fallback };
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
