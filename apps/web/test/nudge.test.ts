// The Sunday reminder's "who hasn't planned next week", and saving a week as the usual week.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@muster/db";
import { addDays } from "@muster/domain";
import {
  addSlot,
  getWeeklyDefaults,
  hasWeeklyDefaults,
  myDays,
  nextMondayAfter,
  nextWeekNudge,
  planningDays,
  saveWeekAsDefaults,
  setDayStatus,
  setWeeklyDefault,
} from "../src/lib/server/availability.ts";
import { createGroup, getInviteToken, joinGroup } from "../src/lib/server/groups.ts";
import { createTestDb, createUser } from "./db.ts";

const CPH = "Europe/Copenhagen";
let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await createTestDb());
});

afterAll(async () => {
  await dispose();
});

describe("nextWeekNudge", () => {
  it("lists members with nothing for next week: no answers and no usual week", async () => {
    const anders = await createUser(db, "Anders", CPH);
    const bo = await createUser(db, "Bo", CPH);
    const carsten = await createUser(db, "Carsten", CPH);
    const dennis = await createUser(db, "Dennis", CPH);
    const group = await createGroup(db, anders.id, { name: "The Dads", timezone: CPH, minPlayers: 2 });
    const token = await getInviteToken(db, anders.id, group);
    await joinGroup(db, bo.id, token, true);
    await joinGroup(db, carsten.id, token, true);
    await joinGroup(db, dennis.id, token, false); // doesn't share, so isn't reminded

    const monday = nextMondayAfter(planningDays(CPH)[0]!);
    await setDayStatus(db, anders, addDays(monday, 3), "no", "web"); // even a No counts as planned
    await setWeeklyDefault(db, bo, 5, { status: "yes", startLocal: "20:30", endLocal: null });

    const status = await nextWeekNudge(db, group);
    expect(status!.monday).toBe(monday);
    expect(status!.members.map((m) => m.displayName)).toEqual(["Anders", "Bo", "Carsten"]);
    expect(status!.waiting.map((m) => m.displayName)).toEqual(["Carsten"]);

    // Answering this week and saving it as the usual week covers next week too.
    const today = planningDays(CPH)[0]!;
    await addSlot(db, carsten, today, "web", "21:00", "maybe");
    expect(await hasWeeklyDefaults(db, carsten.id)).toBe(false);
    expect(await saveWeekAsDefaults(db, carsten)).toBe(1);
    expect((await nextWeekNudge(db, group))!.waiting).toEqual([]);

    const sameDayNextWeek = addDays(today, 7);
    const next = (await myDays(db, carsten.id, [sameDayNextWeek])).get(sameDayNextWeek)!;
    expect(next).toMatchObject({ kind: "default", status: "maybe" });
  });
});

describe("saveWeekAsDefaults", () => {
  it("only changes weekdays answered this week, and copies No as No", async () => {
    const erik = await createUser(db, "Erik", CPH);
    const today = planningDays(CPH)[0]!;
    const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const other = (weekday % 7) + 1;
    await setWeeklyDefault(db, erik, other, { status: "yes", startLocal: "19:00", endLocal: "22:00" });
    await setDayStatus(db, erik, today, "no", "web");

    expect(await saveWeekAsDefaults(db, erik)).toBe(1);
    const defaults = await getWeeklyDefaults(db, erik.id);
    expect(defaults[weekday as 1]).toEqual([expect.objectContaining({ status: "no" })]);
    expect(defaults[other as 1]).toEqual([expect.objectContaining({ status: "yes", startLocal: "19:00" })]);
  });
});
