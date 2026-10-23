import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarDateFor,
  gamingDay,
  isValidLocalDate,
  isValidTimeZone,
  isoWeekday,
  utcToZoned,
  zonedToUtc,
} from "./time.ts";

const CPH = "Europe/Copenhagen";
const utc = (iso: string) => Date.parse(iso);

describe("zonedToUtc", () => {
  it("converts summer and winter times", () => {
    expect(zonedToUtc("2026-10-23", "20:30", CPH)).toBe(utc("2026-10-23T18:30:00Z"));
    expect(zonedToUtc("2026-11-04", "20:30", CPH)).toBe(utc("2026-11-04T19:30:00Z"));
    expect(zonedToUtc("2026-10-23", "20:30", "America/New_York")).toBe(utc("2026-10-24T00:30:00Z"));
  });

  it("moves non-existent spring-forward times forward by the gap", () => {
    expect(zonedToUtc("2026-03-29", "02:30", CPH)).toBe(utc("2026-03-29T01:30:00Z"));
    expect(utcToZoned(utc("2026-03-29T01:30:00Z"), CPH)).toEqual({ date: "2026-03-29", time: "03:30" });
  });

  it("uses the first occurrence of ambiguous fall-back times", () => {
    expect(zonedToUtc("2026-10-25", "02:30", CPH)).toBe(utc("2026-10-25T00:30:00Z"));
  });

  it("is correct right next to a transition", () => {
    expect(zonedToUtc("2026-03-28", "22:00", CPH)).toBe(utc("2026-03-28T21:00:00Z"));
    expect(zonedToUtc("2026-03-29", "03:00", CPH)).toBe(utc("2026-03-29T01:00:00Z"));
  });

  it("round-trips with utcToZoned", () => {
    const instant = zonedToUtc("2026-12-31", "23:45", "Asia/Kolkata");
    expect(utcToZoned(instant, "Asia/Kolkata")).toEqual({ date: "2026-12-31", time: "23:45" });
  });
});

describe("gaming day", () => {
  it("counts the hours after midnight as the previous evening", () => {
    expect(gamingDay(utc("2026-10-23T22:30:00Z"), CPH)).toBe("2026-10-23"); // 00:30 Sat
    expect(gamingDay(utc("2026-10-24T02:59:00Z"), CPH)).toBe("2026-10-23"); // 04:59 Sat
    expect(gamingDay(utc("2026-10-24T03:00:00Z"), CPH)).toBe("2026-10-24"); // 05:00 Sat
  });

  it("maps early-morning wall times to the next calendar date", () => {
    expect(calendarDateFor("2026-10-23", "00:30")).toBe("2026-10-24");
    expect(calendarDateFor("2026-10-23", "21:00")).toBe("2026-10-23");
  });
});

describe("date helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns ISO weekdays", () => {
    expect(isoWeekday("2026-10-23")).toBe(5); // Friday
    expect(isoWeekday("2026-10-25")).toBe(7); // Sunday
  });

  it("validates input", () => {
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
    expect(isValidTimeZone("Europe/Copenhagen")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
