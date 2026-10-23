import { utcToZoned, type LocalDate } from "@party/domain";

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Wed 28 Oct" */
export function dayLabel(day: LocalDate): string {
  return dayFormat.format(Date.parse(`${day}T12:00:00Z`));
}

/** "21:00" in the viewer's time zone. */
export function timeIn(instant: number, tz: string): string {
  return utcToZoned(instant, tz).time;
}

/** Start/end presets for evening play, every 30 minutes from 17:00 to 02:00. */
export const TIME_OPTIONS: string[] = Array.from({ length: 19 }, (_, i) => {
  const minutes = (17 * 60 + i * 30) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export const DEFAULT_START = "20:30";

export const STATUS_LABEL = { yes: "Yes", maybe: "Maybe", no: "No", unknown: "?" } as const;
export const STATUS_ICON = { yes: "✓", maybe: "~", no: "✗", unknown: "" } as const;
