// Discord servers, squads, time slots and characters against a real D1 (architecture §4.6, §5.2).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@muster/db";
import { addMinutesInGamingDay, type LocalDate } from "@muster/domain";
import {
  addSlot,
  groupWeek,
  myDays,
  removeSlot,
  setAvailability,
  setSlot,
  setWeeklyDefault,
  shiftToday,
  upcomingDays,
  addDefaultSlot,
  type WeekView,
} from "../src/lib/server/availability.ts";
import {
  deleteCharacter,
  describeCharacter,
  listCharacters,
  rolesOf,
  saveCharacter,
  setMainLevel,
} from "../src/lib/server/characters.ts";
import {
  createGroup,
  createSquad,
  ensureServerGroup,
  getInviteToken,
  joinGroup,
  leaveGroup,
  listMyGroups,
  setSharing,
  syncServerMemberships,
  syncSquadMemberships,
} from "../src/lib/server/groups.ts";
import type { SessionUser } from "../src/lib/server/session.ts";
import { createTestDb, createUser } from "./db.ts";

const CPH = "Europe/Copenhagen";
let db: Db;
let dispose: () => Promise<void>;
let days: LocalDate[];

const row = (view: WeekView | null, day: LocalDate, name: string) =>
  view!.days.find((d) => d.day === day)!.members.find((m) => m.displayName === name);
const dayOf = (view: WeekView | null, day: LocalDate) => view!.days.find((d) => d.day === day)!;
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+01:00`);

beforeAll(async () => {
  // Monday 2 Nov 2026, 13:00 in Copenhagen (winter time, UTC+1).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  ({ db, dispose } = await createTestDb());
  days = upcomingDays(CPH);
});

afterAll(async () => {
  vi.useRealTimers();
  await dispose();
});

describe("Discord servers", () => {
  let anders: SessionUser, bo: SessionUser;
  let dads: string, work: string, privateGroup: string;

  beforeAll(async () => {
    anders = await createUser(db, "Anders", CPH);
    bo = await createUser(db, "Bo", CPH);
    dads = (await ensureServerGroup(db, { guildId: "111111", name: "The Dads", iconUrl: null }, CPH)).id;
    work = (await ensureServerGroup(db, { guildId: "222222", name: "Work", iconUrl: null }, CPH)).id;
    privateGroup = await createGroup(db, anders.id, { name: "Side group", timezone: CPH, minPlayers: 2 });
    await joinGroup(db, bo.id, await getInviteToken(db, anders.id, privateGroup), true);
  });

  it("finds the same group for a server every time and follows renames", async () => {
    const again = await ensureServerGroup(db, { guildId: "111111", name: "The Dads (EU)", iconUrl: "x.png" }, "UTC");
    expect(again.id).toBe(dads);
    expect(again).toMatchObject({ name: "The Dads (EU)", iconUrl: "x.png", timezone: CPH });
  });

  it("joins servers found at login unshared and undecided, and admin follows Discord", async () => {
    await syncServerMemberships(db, anders.id, [{ groupId: dads, admin: true }, { groupId: work, admin: false }], {
      complete: true,
      shareByDefault: false,
    });
    const mine = await listMyGroups(db, anders.id);
    expect(mine.find((g) => g.id === dads)).toMatchObject({ kind: "server", role: "admin", shareAvailability: false, shareDecidedAt: null });
    expect(mine.find((g) => g.id === work)).toMatchObject({ role: "member", shareAvailability: false });
    expect(mine.find((g) => g.id === privateGroup)).toMatchObject({ kind: "private", role: "admin" });
  });

  it("shares right away when the user acted in the server", async () => {
    await syncServerMemberships(db, bo.id, [{ groupId: dads, admin: false }], { complete: false, shareByDefault: true });
    const bos = await listMyGroups(db, bo.id);
    expect(bos.find((g) => g.id === dads)).toMatchObject({ shareAvailability: true, shareDecidedAt: expect.any(Number) });
  });

  it("hides an undecided member's answers until they choose to share", async () => {
    await setAvailability(db, anders, { day: days[1]!, status: "yes", startLocal: "20:00", endLocal: null }, "web");
    expect(row(await groupWeek(db, bo, dads), days[1]!, "Anders")?.status).toBe("unknown");
    await setSharing(db, anders.id, dads, true);
    expect(row(await groupWeek(db, bo, dads), days[1]!, "Anders")?.status).toBe("yes");
  });

  it("marks times without an end as open-ended, so the group sees 'late'", async () => {
    await setAvailability(db, anders, { day: days[2]!, status: "yes", startLocal: "20:30", endLocal: null }, "web");
    await setAvailability(db, anders, { day: days[3]!, status: "yes", startLocal: "20:30", endLocal: "23:00" }, "web");
    expect(row(await groupWeek(db, bo, dads), days[2]!, "Anders")?.slots[0]?.openEnd).toBe(true);
    expect(row(await groupWeek(db, bo, dads), days[3]!, "Anders")?.slots[0]?.openEnd).toBe(false);
  });

  it("leaves servers the user is no longer in, but never touches invite groups", async () => {
    await syncServerMemberships(db, anders.id, [{ groupId: dads, admin: true }], { complete: true, shareByDefault: false });
    const ids = (await listMyGroups(db, anders.id)).map((g) => g.id);
    expect(ids).toContain(dads);
    expect(ids).not.toContain(work);
    expect(ids).toContain(privateGroup);
    expect(await groupWeek(db, anders, work)).toBeNull();
  });

  it("won't let people leave a server group from the website", async () => {
    await expect(leaveGroup(db, bo.id, dads)).rejects.toThrow("through Discord");
  });

  describe("squads", () => {
    const RAID_ROLE = "900001";
    let raid: string;
    let carsten: SessionUser;

    beforeAll(async () => {
      carsten = await createUser(db, "Carsten", CPH);
      await syncServerMemberships(db, carsten.id, [{ groupId: dads, admin: false }], { complete: false, shareByDefault: true });
      raid = await createSquad(db, anders.id, dads, { name: "Raid team", roleId: RAID_ROLE });
    });

    it("only server admins can make squads", async () => {
      await expect(createSquad(db, bo.id, dads, { name: "Nope", roleId: "900002" })).rejects.toThrow("admins");
      await expect(createSquad(db, anders.id, privateGroup, { name: "Nope", roleId: "900003" })).rejects.toThrow("Discord server");
    });

    it("puts exactly the people with the role in the squad", async () => {
      await syncSquadMemberships(db, bo.id, dads, [RAID_ROLE, "123"]);
      await syncSquadMemberships(db, carsten.id, dads, ["123"]);
      await syncSquadMemberships(db, anders.id, dads, [RAID_ROLE]);
      const view = await groupWeek(db, anders, raid);
      expect(view!.members.map((m) => m.displayName).sort()).toEqual(["Anders", "Bo"]);
      expect(await groupWeek(db, carsten, raid)).toBeNull();
    });

    it("takes people out when they lose the role", async () => {
      await syncSquadMemberships(db, bo.id, dads, []);
      expect((await groupWeek(db, anders, raid))!.members.map((m) => m.displayName)).toEqual(["Anders"]);
    });

    it("follows the server's sharing switch", async () => {
      await syncSquadMemberships(db, bo.id, dads, [RAID_ROLE]);
      await setAvailability(db, bo, { day: days[2]!, status: "yes", startLocal: "21:00", endLocal: null }, "web");
      expect(row(await groupWeek(db, anders, raid), days[2]!, "Bo")?.status).toBe("yes");
      await setSharing(db, bo.id, dads, false);
      expect(row(await groupWeek(db, anders, raid), days[2]!, "Bo")?.status).toBe("unknown");
      await setSharing(db, bo.id, dads, true);
    });

    it("drops squad membership when the user leaves the server", async () => {
      await syncServerMemberships(db, bo.id, [], { complete: true, shareByDefault: false });
      expect(await groupWeek(db, bo, raid)).toBeNull();
      expect(await groupWeek(db, bo, dads)).toBeNull();
    });
  });
});

describe("time slots", () => {
  let ida: SessionUser, jens: SessionUser;
  let group: string;

  beforeAll(async () => {
    ida = await createUser(db, "Ida", CPH);
    jens = await createUser(db, "Jens", CPH);
    group = await createGroup(db, ida.id, { name: "Weekend crew", timezone: CPH, minPlayers: 2 });
    await joinGroup(db, jens.id, await getInviteToken(db, ida.id, group), true);
  });

  it("keeps several slots per day, earliest first, and matches on any of them", async () => {
    const day = days[5]!; // Saturday
    await setSlot(db, ida, day, 0, { status: "yes", startLocal: "20:00", endLocal: "23:00" }, "web");
    await setSlot(db, ida, day, 9, { status: "maybe", startLocal: "12:00", endLocal: "15:00" }, "web");
    await setAvailability(db, jens, { day, status: "yes", startLocal: "13:00", endLocal: "16:00" }, "web");

    const ida_ = row(await groupWeek(db, jens, group), day, "Ida")!;
    expect(ida_.status).toBe("yes");
    expect(ida_.slots.map((s) => [s.status, s.startsAt])).toEqual([
      ["maybe", at(day, "12:00")],
      ["yes", at(day, "20:00")],
    ]);
    // Only the midday slot overlaps with Jens, and it's a Maybe.
    expect(dayOf(await groupWeek(db, jens, group), day).best).toMatchObject({ startsAt: at(day, "13:00"), includesMaybe: true });
  });

  it("adds a slot after the last one and removes slots by position", async () => {
    const day = days[6]!;
    await setAvailability(db, ida, { day, status: "yes", startLocal: "12:00", endLocal: "14:00" }, "web");
    await addSlot(db, ida, day, "web");
    let mine = (await myDays(db, ida.id, [day])).get(day)!;
    expect(mine.kind !== "unknown" && mine.slots.map((s) => s.startLocal)).toEqual(["12:00", "15:00"]);
    await removeSlot(db, ida, day, 0, "web");
    mine = (await myDays(db, ida.id, [day])).get(day)!;
    expect(mine.kind !== "unknown" && mine.slots.map((s) => s.startLocal)).toEqual(["15:00"]);
    await removeSlot(db, ida, day, 0, "web");
    expect((await myDays(db, ida.id, [day])).get(day)!.kind).toBe("unknown");
  });

  it("a No replaces all slots, and caps a day at four times", async () => {
    const day = days[4]!;
    await setAvailability(db, ida, { day, status: "yes", startLocal: "12:00", endLocal: null }, "web");
    for (let i = 0; i < 3; i++) await addSlot(db, ida, day, "web");
    await expect(addSlot(db, ida, day, "web")).rejects.toThrow("up to 4");
    await setSlot(db, ida, day, 0, { status: "no", startLocal: null, endLocal: null }, "web");
    expect((await myDays(db, ida.id, [day])).get(day)).toMatchObject({ kind: "explicit", status: "no", slots: [] });
  });

  it("copies a multi-slot default before changing one of its slots", async () => {
    const day = days[3]!; // Thursday
    await setWeeklyDefault(db, ida, 4, { status: "yes", startLocal: "19:00", endLocal: "20:00" });
    await addDefaultSlot(db, ida, 4);
    await setSlot(db, ida, day, 1, { status: "maybe", startLocal: "22:00", endLocal: null }, "web");
    const mine = (await myDays(db, ida.id, [day])).get(day)!;
    expect(mine.kind).toBe("explicit");
    expect(mine.kind !== "unknown" && mine.slots.map((s) => [s.status, s.startLocal])).toEqual([
      ["yes", "19:00"],
      ["maybe", "22:00"],
    ]);
  });

  it("running late moves the slot you're in or the next one", async () => {
    const today = days[0]!; // 13:00 now
    await setSlot(db, ida, today, 0, { status: "yes", startLocal: "12:00", endLocal: "14:00" }, "web");
    await setSlot(db, ida, today, 1, { status: "yes", startLocal: "20:30", endLocal: null }, "web");
    const first = await shiftToday(db, ida, 30, "web");
    expect(first).toMatchObject({ slot: 0, from: "12:00", to: "12:30" });

    vi.setSystemTime(new Date("2026-11-02T15:00:00Z")); // 16:00, after the midday slot
    const second = await shiftToday(db, ida, 30, "web");
    expect(second).toMatchObject({ slot: 1, from: "20:30", to: addMinutesInGamingDay("20:30", 30) });
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  });
});

describe("characters", () => {
  let kim: SessionUser, lars: SessionUser;
  let group: string;

  beforeAll(async () => {
    kim = await createUser(db, "Kim", CPH);
    lars = await createUser(db, "Lars", CPH);
    group = await createGroup(db, kim.id, { name: "Alts", timezone: CPH, minPlayers: 2 });
    await joinGroup(db, lars.id, await getInviteToken(db, kim.id, group), true);
  });

  it("makes the first character the main and keeps only one main", async () => {
    await saveCharacter(db, kim.id, { name: "Kimdruid", realmType: "pvp", roles: ["tank", "healer"], faction: "horde", class: "druid", level: 30, isMain: false });
    await saveCharacter(db, kim.id, { name: "Kimmage", realmType: "", roles: [], faction: "horde", class: "mage", level: 12, isMain: false });
    let chars = await listCharacters(db, kim.id);
    expect(chars.filter((c) => c.isMain).map((c) => c.name)).toEqual(["Kimdruid"]);

    const mage = chars.find((c) => c.name === "Kimmage")!;
    expect(rolesOf(mage)).toEqual(["dps"]); // one-role classes get their role automatically
    await saveCharacter(db, kim.id, { ...mage, realmType: mage.realmType ?? "", roles: rolesOf(mage), isMain: true });
    chars = await listCharacters(db, kim.id);
    expect(chars.filter((c) => c.isMain).map((c) => c.name)).toEqual(["Kimmage"]);
  });

  it("checks input and ownership", async () => {
    const base = { name: "Okname", realmType: "", roles: [] as string[], faction: "alliance", class: "rogue", level: 10, isMain: false };
    await expect(saveCharacter(db, kim.id, { ...base, level: 61 })).rejects.toThrow("Level");
    await expect(saveCharacter(db, kim.id, { ...base, class: "monk" })).rejects.toThrow("class");
    await expect(saveCharacter(db, kim.id, { ...base, faction: "neutral" })).rejects.toThrow("Alliance or Horde");
    await expect(saveCharacter(db, kim.id, { ...base, name: "kimdruid" })).rejects.toThrow("already have");
    await expect(saveCharacter(db, kim.id, { ...base, class: "warrior", roles: ["healer"] })).rejects.toThrow("Tank or DPS");
    await expect(saveCharacter(db, kim.id, { ...base, class: "druid", roles: [] })).rejects.toThrow("Pick a role");
    await expect(saveCharacter(db, kim.id, { ...base, realmType: "pvp-ish" })).rejects.toThrow("realm type");
    const kims = await listCharacters(db, kim.id);
    await expect(saveCharacter(db, lars.id, { ...base, id: kims[0]!.id })).rejects.toThrow("isn't yours");
  });

  it("sets the main's level from /level and moves the main when it's deleted", async () => {
    expect(await setMainLevel(db, kim.id, 13, "discord")).toMatchObject({ name: "Kimmage", level: 13 });
    await expect(setMainLevel(db, lars.id, 5, "discord")).rejects.toThrow("Add a character");
    const mage = (await listCharacters(db, kim.id)).find((c) => c.name === "Kimmage")!;
    await deleteCharacter(db, kim.id, mage.id);
    expect((await listCharacters(db, kim.id)).filter((c) => c.isMain).map((c) => c.name)).toEqual(["Kimdruid"]);
  });

  it("shows mains only to groups the player shares with", async () => {
    const main = (await groupWeek(db, lars, group))!.characters.get(kim.id)!;
    expect(main).toMatchObject({ name: "Kimdruid", class: "druid", realmType: "pvp" });
    expect(describeCharacter(main)).toBe("Horde Druid · 30 · Tank, Healer");
    await setSharing(db, kim.id, group, false);
    expect((await groupWeek(db, lars, group))!.characters.has(kim.id)).toBe(false);
  });
});
