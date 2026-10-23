// Privacy and weekly-default behaviour against a real D1 (architecture §5.2).
// Groups: "Dads" = Anders (admin) + Bo. "Work" = Carsten (admin) + Anders.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@party/db";
import { addDays, isoWeekday, type LocalDate } from "@party/domain";
import {
  boardWeek,
  copyWeekForward,
  groupWeek,
  myDays,
  myEntries,
  setAvailability,
  setFreeNow,
  setWeeklyDefault,
  upcomingDays,
  type WeekView,
} from "../src/lib/server/availability.ts";
import {
  createGroup,
  findInvite,
  getInviteToken,
  joinGroup,
  leaveGroup,
  resetInvite,
  setSharing,
} from "../src/lib/server/groups.ts";
import type { SessionUser } from "../src/lib/server/session.ts";
import { createTestDb, createUser, limitEntryToGroups } from "./db.ts";

const CPH = "Europe/Copenhagen";
let db: Db;
let dispose: () => Promise<void>;
let anders: SessionUser, bo: SessionUser, carsten: SessionUser;
let dads: string, work: string;
let days: LocalDate[];

const row = (view: WeekView | null, day: LocalDate, name: string) =>
  view!.days.find((d) => d.day === day)!.members.find((m) => m.displayName === name);
const dayOf = (view: WeekView | null, day: LocalDate) => view!.days.find((d) => d.day === day)!;
const yes = (day: LocalDate, start: string) => ({ day, status: "yes", startLocal: start, endLocal: null });

beforeAll(async () => {
  // Wednesday 28 Oct 2026, 13:00 in Copenhagen: same gaming day in every zone used here.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));

  ({ db, dispose } = await createTestDb());
  anders = await createUser(db, "Anders", CPH);
  bo = await createUser(db, "Bo", CPH);
  carsten = await createUser(db, "Carsten", "Europe/London");
  dads = await createGroup(db, anders.id, { name: "Dads", timezone: CPH, minPlayers: 2 });
  work = await createGroup(db, carsten.id, { name: "Work", timezone: CPH, minPlayers: 2 });
  await joinGroup(db, bo.id, await getInviteToken(db, anders.id, dads), true);
  await joinGroup(db, anders.id, await getInviteToken(db, carsten.id, work), true);
  days = upcomingDays(CPH);
});

afterAll(async () => {
  vi.useRealTimers();
  await dispose();
});

describe("membership boundaries", () => {
  it("returns nothing to non-members", async () => {
    expect(await groupWeek(db, carsten, dads)).toBeNull();
    expect(await groupWeek(db, bo, work)).toBeNull();
  });

  it("never lists members of one group in another", async () => {
    const workView = await groupWeek(db, anders, work);
    expect(workView!.members.map((m) => m.displayName).sort()).toEqual(["Anders", "Carsten"]);
    const dadsBoard = await boardWeek(db, dads);
    expect(dadsBoard!.members.map((m) => m.displayName).sort()).toEqual(["Anders", "Bo"]);
  });

  it("keeps invite links admin-only and kills reset links", async () => {
    await expect(getInviteToken(db, bo.id, dads)).rejects.toThrow("Only group admins");
    const old = await getInviteToken(db, anders.id, dads);
    await resetInvite(db, anders.id, dads);
    expect(await findInvite(db, old)).toBeNull();
    expect(await findInvite(db, await getInviteToken(db, anders.id, dads))).toMatchObject({ groupName: "Dads" });
  });
});

describe("per-day sharing", () => {
  it("shows an entry shared with all groups everywhere", async () => {
    await setAvailability(db, anders, yes(days[0]!, "20:30"), "web");
    expect(row(await groupWeek(db, bo, dads), days[0]!, "Anders")?.status).toBe("yes");
    expect(row(await groupWeek(db, carsten, work), days[0]!, "Anders")?.status).toBe("yes");
  });

  it("hides a day limited to Dads from Work, including counts, best start and the board", async () => {
    await setAvailability(db, anders, yes(days[1]!, "20:00"), "web");
    await setAvailability(db, carsten, yes(days[1]!, "19:00"), "web");
    await limitEntryToGroups(db, anders.id, days[1]!, [dads]);

    expect(row(await groupWeek(db, bo, dads), days[1]!, "Anders")?.status).toBe("yes");

    for (const view of [await groupWeek(db, carsten, work), await boardWeek(db, work)]) {
      expect(row(view, days[1]!, "Anders")).toMatchObject({ status: "unknown", startsAt: null, kind: null });
      expect(dayOf(view, days[1]!).counts.yes).toBe(1);
      expect(dayOf(view, days[1]!).best).toBeNull();
    }
  });
});

describe("sharing switch", () => {
  it("hides answers, defaults and free-now from a group the user stopped sharing with", async () => {
    await setAvailability(db, bo, yes(days[0]!, "21:00"), "web");
    await setWeeklyDefault(db, bo, isoWeekday(days[2]!), { status: "yes", startLocal: "21:00", endLocal: null });
    await setFreeNow(db, bo.id, Date.now() + 60 * 60_000);

    const before = await groupWeek(db, anders, dads);
    expect(row(before, days[0]!, "Bo")?.status).toBe("yes");
    expect(row(before, days[2]!, "Bo")?.kind).toBe("default");
    expect(before!.freeNow.map((f) => f.displayName)).toContain("Bo");

    await setSharing(db, bo.id, dads, false);
    for (const view of [await groupWeek(db, anders, dads), await boardWeek(db, dads)]) {
      expect(row(view, days[0]!, "Bo")?.status).toBe("unknown");
      expect(row(view, days[2]!, "Bo")?.status).toBe("unknown");
      expect(view!.freeNow).toEqual([]);
      expect(dayOf(view, days[0]!).best?.memberIds ?? []).not.toContain(bo.id);
    }
    await setSharing(db, bo.id, dads, true);
  });
});

describe("weekly defaults", () => {
  it("fill unanswered days, and an explicit answer overrides them", async () => {
    const day = days[3]!;
    await setWeeklyDefault(db, anders, isoWeekday(day), { status: "maybe", startLocal: "20:00", endLocal: null });
    expect(row(await groupWeek(db, bo, dads), day, "Anders")).toMatchObject({ status: "maybe", kind: "default" });
    expect((await myDays(db, anders.id, [day])).get(day)).toMatchObject({ kind: "default", status: "maybe" });

    await setAvailability(db, anders, { day, status: "no", startLocal: null, endLocal: null }, "web");
    expect(row(await groupWeek(db, bo, dads), day, "Anders")).toMatchObject({ status: "no", kind: "explicit" });
  });

  it("don't leak through a day that's explicitly hidden from a group", async () => {
    const day = days[4]!;
    await setWeeklyDefault(db, anders, isoWeekday(day), { status: "yes", startLocal: "20:00", endLocal: null });
    await setAvailability(db, anders, yes(day, "21:00"), "web");
    await limitEntryToGroups(db, anders.id, day, [dads]);
    expect(row(await groupWeek(db, carsten, work), day, "Anders")?.status).toBe("unknown");
  });

  it("count towards the best start time", async () => {
    const day = days[5]!;
    await setWeeklyDefault(db, anders, isoWeekday(day), { status: "yes", startLocal: "20:00", endLocal: null });
    await setWeeklyDefault(db, bo, isoWeekday(day), { status: "yes", startLocal: "20:30", endLocal: null });
    expect(dayOf(await groupWeek(db, anders, dads), day).best).toMatchObject({
      startsAt: Date.parse(`${day}T20:30:00+01:00`),
      includesMaybe: false,
    });
  });
});

describe("copy week forward", () => {
  it("copies shared days, skips limited ones and never overwrites", async () => {
    const ivan = await createUser(db, "Ivan", CPH);
    await setAvailability(db, ivan, yes(days[0]!, "20:00"), "web");
    await setAvailability(db, ivan, yes(days[1]!, "20:00"), "web");
    await limitEntryToGroups(db, ivan.id, days[1]!, [dads]);
    await setAvailability(db, ivan, yes(days[2]!, "20:00"), "web");
    await setAvailability(db, ivan, { day: addDays(days[2]!, 7), status: "no", startLocal: null, endLocal: null }, "web");

    expect(await copyWeekForward(db, ivan)).toBe(1);
    const next = await myEntries(db, ivan.id, [1, 2, 3].map((i) => addDays(days[i - 1]!, 7)));
    expect(next.get(addDays(days[0]!, 7))).toMatchObject({ status: "yes", startLocal: "20:00" });
    expect(next.has(addDays(days[1]!, 7))).toBe(false);
    expect(next.get(addDays(days[2]!, 7))?.status).toBe("no");
  });
});

describe("leaving a group", () => {
  it("removes the member from that group's views at once but keeps their own entries", async () => {
    await leaveGroup(db, bo.id, dads);
    const view = await groupWeek(db, anders, dads);
    expect(view!.members.map((m) => m.displayName)).toEqual(["Anders"]);
    expect(row(view, days[0]!, "Bo")).toBeUndefined();
    expect((await myEntries(db, bo.id, [days[0]!])).get(days[0]!)?.status).toBe("yes");
    expect(await groupWeek(db, bo, dads)).toBeNull();
  });
});
