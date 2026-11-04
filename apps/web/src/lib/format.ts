import { utcToZoned, type LocalDate } from "@muster/domain";

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Wed 28 Oct" */
export function dayLabel(day: LocalDate): string {
  return dayFormat.format(Date.parse(`${day}T12:00:00Z`));
}

/** "21:00" in the viewer's time zone. */
export function timeIn(instant: number, tz: string): string {
  return utcToZoned(instant, tz).time;
}

const wallTime = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Every half hour of a gaming day, from 06:00 through 04:30 the next morning. */
export const TIME_OPTIONS: string[] = Array.from({ length: 46 }, (_, i) => wallTime(6 * 60 + i * 30));

/**
 * Discord menus hold at most 25 choices: midday hours (12:00–16:00), then every half hour of the
 * evening (17:00–02:00).
 */
export const DISCORD_TIME_OPTIONS: string[] = [
  ...Array.from({ length: 5 }, (_, i) => wallTime((12 + i) * 60)),
  ...Array.from({ length: 19 }, (_, i) => wallTime(17 * 60 + i * 30)),
];

/** The options to show for a picker, making sure the current value is one of them. */
export function timeOptionsWith(options: readonly string[], current: string | null | undefined): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current].sort((a, b) => ((a < "05:00" ? 1 : 0) - (b < "05:00" ? 1 : 0)) || a.localeCompare(b));
}

export const DEFAULT_START = "20:30";

export const STATUS_LABEL = { yes: "Yes", maybe: "Maybe", no: "No", unknown: "?" } as const;
export const STATUS_ICON = { yes: "✓", maybe: "~", no: "✗", unknown: "" } as const;
