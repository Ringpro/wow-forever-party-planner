// Wall-time ↔ UTC conversion with IANA time zones, using only Intl (works in Workers and Node).
// Rules: docs/architecture.md §7.

/** 'YYYY-MM-DD' */
export type LocalDate = string;
/** 'HH:MM', 24-hour */
export type WallTime = string;
/** ISO weekday: 1 = Monday … 7 = Sunday */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A gaming day runs from 05:00 to 05:00 local, so late sessions belong to the evening they started. */
export const GAMING_DAY_ROLLOVER: WallTime = "05:00";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

export function isValidWallTime(time: string): boolean {
  return TIME_RE.test(time);
}

/** The wall clock reading as if it were UTC, in epoch ms. */
function wallClockMs(date: LocalDate, time: WallTime): number {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) throw new RangeError(`Invalid local date/time: ${date} ${time}`);
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
}

/** Offset of `tz` from UTC at `instant`, in ms (e.g. +3 600 000 for CET). */
export function tzOffsetMs(instant: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Converts a local wall time to a UTC instant.
 * Ambiguous times (clocks going back) use the first occurrence. Times that don't exist
 * (clocks going forward) move forward by the length of the gap, e.g. 02:30 → 03:30.
 */
export function zonedToUtc(date: LocalDate, time: WallTime, tz: string): number {
  const wall = wallClockMs(date, time);
  const offsetBefore = tzOffsetMs(wall - DAY, tz);
  const offsetAfter = tzOffsetMs(wall + DAY, tz);
  const candidates = [...new Set([wall - offsetBefore, wall - offsetAfter])].sort((a, b) => a - b);
  for (const c of candidates) {
    if (c + tzOffsetMs(c, tz) === wall) return c;
  }
  return wall - offsetBefore;
}

export function utcToZoned(instant: number, tz: string): { date: LocalDate; time: WallTime } {
  const iso = new Date(instant + tzOffsetMs(instant, tz)).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** The gaming day an instant belongs to in `tz`. */
export function gamingDay(instant: number, tz: string): LocalDate {
  const rolloverMs = wallClockMs("1970-01-01", GAMING_DAY_ROLLOVER);
  return new Date(instant + tzOffsetMs(instant, tz) - rolloverMs).toISOString().slice(0, 10);
}

/** Calendar date of a wall time on a gaming day: times before the rollover are after midnight. */
export function calendarDateFor(day: LocalDate, time: WallTime): LocalDate {
  return time < GAMING_DAY_ROLLOVER ? addDays(day, 1) : day;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(wallClockMs(date, "00:00") + days * DAY).toISOString().slice(0, 10);
}

export function isoWeekday(date: LocalDate): IsoWeekday {
  const day = new Date(wallClockMs(date, "00:00")).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}
