// The real addon code in simulated WoW clients. See world.js and fake-wow.lua.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorld } from "./world.js";

let world;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(() => world.close());

const quests = (...ids) => ids.map((id) => ({ id, title: `Quest ${id}` }));
const ids = (from, count) => Array.from({ length: count }, (_, i) => from + i * 7);

describe("snapshot", () => {
  it("records level, zone and real quests only, sorted, per character", async () => {
    const anders = await world.addPlayer({ name: "Anders", level: 23 });
    anders.setQuests([
      { id: 0, title: "Elwynn Forest", header: true },
      { id: 300, title: "Hidden helper", hidden: true },
      { id: 120, title: "Report to Goldshire", done: true },
      { id: 54, title: "The Fargodeep Mine" },
    ]);
    anders.fire("QUEST_LOG_UPDATE");
    world.advance(3);

    const snapshot = anders.get('MusterDB.characters["Anders-Firemaw"]');
    expect(snapshot).toMatchObject({ name: "Anders", realm: "Firemaw", level: 23, zone: "Elwynn Forest", source: "addon" });
    expect(snapshot.quests).toEqual([
      { id: 54, title: "The Fargodeep Mine", level: 20, done: false },
      { id: 120, title: "Report to Goldshire", level: 20, done: true },
    ]);
  });

  it("waits for a burst of quest log updates to settle", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const before = anders.get("ADDON_NS.current.observedAt");
    anders.setQuests(quests(1, 2));
    for (let i = 0; i < 5; i++) anders.fire("QUEST_LOG_UPDATE");
    world.advance(1);
    expect(anders.get("#ADDON_NS.current.quests")).toBe(1);
    world.advance(2);
    expect(anders.get("#ADDON_NS.current.quests")).toBe(2);
    expect(anders.get("ADDON_NS.current.observedAt")).toBeGreaterThan(before);
  });
});

describe("sharing with the group", () => {
  it("sends nothing while solo", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1, 2) });
    world.advance(10);
    expect(anders.sent()).toEqual([]);
  });

  it("lets two grouped players see each other's quests", async () => {
    const anders = await world.addPlayer({ name: "Anders", level: 21, quests: quests(10, 20, 30) });
    const bo = await world.addPlayer({ name: "Bo", level: 19, class: "MAGE", quests: quests(20, 30, 40) });
    world.group(["Anders", "Bo"]);
    world.advance(10);

    expect(anders.peers()).toEqual({ "Bo-Firemaw": { level: 19, class: "MAGE", quests: [20, 30, 40], seenAt: expect.any(Number) } });
    expect(bo.peers()["Anders-Firemaw"]).toMatchObject({ level: 21, class: "WARRIOR", quests: [10, 20, 30] });
    expect(anders.sent().every((m) => m.channel === "PARTY")).toBe(true);
  });

  it("explains the overlap with /muster shared", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: [{ id: 20, title: "Wolves Across the Border" }, { id: 30, title: "Kobold Candles" }] });
    const bo = await world.addPlayer({ name: "Bo", quests: quests(20, 30, 40, 50) });
    anders.set("Fake.titles", { 40: "The Collector" });
    world.group(["Anders", "Bo"]);
    world.advance(10);

    const out = anders.slash("shared");
    expect(out).toContain("With Bo: 2 shared quests");
    expect(out).toContain("= Wolves Across the Border");
    expect(out).toContain("= Kobold Candles");
    expect(out).toContain("They also have 2 you don't:");
    expect(out).toContain("+ The Collector");
    expect(out).toContain("+ quest 50"); // title unknown locally
    expect(bo.slash("")).toContain("Anders: level 20, 2 active quests");
  });

  it("splits long quest lists so every message fits, and reassembles them", async () => {
    const many = ids(100000, 80); // 80 six-digit quest IDs: ~560 characters
    const anders = await world.addPlayer({ name: "Anders", quests: quests(...many) });
    const bo = await world.addPlayer({ name: "Bo" });
    world.group(["Anders", "Bo"]);
    world.advance(10);

    const parts = anders.sent().filter((m) => m.msg.startsWith("S1;"));
    expect(parts.length).toBeGreaterThan(2);
    for (const m of anders.sent()) expect(m.msg.length).toBeLessThanOrEqual(255);
    expect(bo.peers()["Anders-Firemaw"].quests).toEqual(many);
  });

  it("follows quest log changes", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1, 2, 3) });
    const bo = await world.addPlayer({ name: "Bo" });
    world.group(["Anders", "Bo"]);
    world.advance(10);
    anders.setQuests(quests(2, 3, 4));
    anders.fire("QUEST_LOG_UPDATE");
    world.advance(10);
    expect(bo.peers()["Anders-Firemaw"].quests).toEqual([2, 3, 4]);
  });

  it("uses the raid and instance channels when appropriate", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const bo = await world.addPlayer({ name: "Bo", quests: quests(1) });
    world.group(["Anders", "Bo"], { kind: "RAID" });
    world.advance(10);
    expect(new Set(anders.sent().map((m) => m.channel))).toEqual(new Set(["RAID"]));

    const carsten = await world.addPlayer({ name: "Carsten", quests: quests(2) });
    const dennis = await world.addPlayer({ name: "Dennis", quests: quests(2) });
    world.group(["Carsten", "Dennis"], { id: "dungeon", kind: "INSTANCE_CHAT" });
    world.advance(10);
    expect(new Set(carsten.sent().map((m) => m.channel))).toEqual(new Set(["INSTANCE_CHAT"]));
    expect(dennis.peers()["Carsten-Firemaw"].quests).toEqual([2]);
    expect(bo.peers()).not.toHaveProperty("Carsten-Firemaw");
  });

  it("catches up after a /reload while already in a group", async () => {
    await world.addPlayer({ name: "Anders", quests: quests(1, 2) });
    const bo = await world.addPlayer({ name: "Bo", quests: quests(2, 3) });
    world.group(["Anders", "Bo"]);
    world.advance(10);

    // Anders reloads: a fresh client with an empty peer list, already in the group.
    world.players.get("Anders").engine.global.close();
    world.players.get("Anders").groupId = null;
    const reloaded = await world.addPlayer({ name: "Anders", quests: quests(1, 2), groupId: "g1" });
    world.advance(10);
    expect(reloaded.peers()["Bo-Firemaw"].quests).toEqual([2, 3]);
    expect(bo.peers()["Anders-Firemaw"].quests).toEqual([1, 2]);
  });

  it("handles players from other realms", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    await world.addPlayer({ name: "Bo", realm: "Mograine", quests: quests(1) });
    world.group(["Anders", "Bo"]);
    world.advance(10);
    expect(Object.keys(anders.peers())).toEqual(["Bo-Mograine"]);
    world.group(["Anders", "Bo"]); // another roster update must not drop a cross-realm member
    world.advance(10);
    expect(Object.keys(anders.peers())).toEqual(["Bo-Mograine"]);
  });
});

describe("leaving and opting out", () => {
  it("forgets people who leave the group", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const bo = await world.addPlayer({ name: "Bo", quests: quests(1) });
    await world.addPlayer({ name: "Carsten", quests: quests(1) });
    world.group(["Anders", "Bo", "Carsten"]);
    world.advance(10);
    expect(Object.keys(anders.peers()).sort()).toEqual(["Bo-Firemaw", "Carsten-Firemaw"]);

    world.leave("Carsten");
    world.advance(10);
    expect(Object.keys(anders.peers())).toEqual(["Bo-Firemaw"]);

    world.leave("Bo"); // group of one disbands
    world.advance(10);
    expect(anders.peers()).toEqual({});
    expect(bo.peers()).toEqual({});
  });

  it("stops sharing on /muster share off and starts again on /muster share on", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const bo = await world.addPlayer({ name: "Bo", quests: quests(1) });
    world.group(["Anders", "Bo"]);
    world.advance(10);
    expect(bo.peers()).toHaveProperty("Anders-Firemaw");

    anders.slash("share off");
    world.advance(10);
    expect(bo.peers()).toEqual({});
    expect(anders.get("MusterDB.settings.share")).toBe(false);

    // Requests from others and our own quest changes must not leak anything while off.
    const sentWhileOff = anders.sent().length;
    bo.run("ADDON_NS.RequestStatus()");
    anders.setQuests(quests(1, 2));
    anders.fire("QUEST_LOG_UPDATE");
    world.advance(10);
    expect(anders.sent().slice(sentWhileOff).filter((m) => m.msg.startsWith("S1;"))).toEqual([]);
    expect(bo.peers()).toEqual({});

    anders.slash("share on");
    world.advance(10);
    expect(bo.peers()["Anders-Firemaw"].quests).toEqual([1, 2]);
  });

  it("keeps the opt-out after a reload", async () => {
    const anders = await world.addPlayer({ name: "Anders" });
    anders.slash("share off");
    const saved = anders.get("MusterDB");
    const again = await world.addPlayer({ name: "Anders2" });
    again.set("MusterDB", saved);
    again.fire("ADDON_LOADED", "Muster");
    expect(again.get("ADDON_NS.db.settings.share")).toBe(false);
  });
});

describe("robustness", () => {
  it("resends after combat when a send was blocked", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const bo = await world.addPlayer({ name: "Bo" });
    anders.set("Fake.blockSends", true);
    anders.set("Fake.combat", true);
    world.group(["Anders", "Bo"]);
    world.advance(10);
    expect(bo.peers()).toEqual({});

    anders.set("Fake.blockSends", false);
    anders.set("Fake.combat", false);
    anders.fire("PLAYER_REGEN_ENABLED");
    world.advance(10);
    expect(bo.peers()["Anders-Firemaw"].quests).toEqual([1]);
  });

  it("ignores its own echo, other prefixes and malformed messages", async () => {
    const anders = await world.addPlayer({ name: "Anders", quests: quests(1) });
    const prefix = "Muster";
    anders.fire("CHAT_MSG_ADDON", prefix, "S1;1;1;1;20;WARRIOR;1", "PARTY", "Anders-Firemaw");
    anders.fire("CHAT_MSG_ADDON", "OtherAddon", "S1;1;1;1;20;WARRIOR;1", "PARTY", "Bo-Firemaw");
    for (const junk of ["", "S1", "S1;x;y;z", "S1;1;5;2;20;MAGE;1", "S1;1;1;999;20;MAGE;1", "Z9;;;"]) {
      anders.fire("CHAT_MSG_ADDON", prefix, junk, "PARTY", "Bo-Firemaw");
    }
    expect(anders.peers()).toEqual({});
  });

  it("drops a half-received list when a newer one starts", async () => {
    const anders = await world.addPlayer({ name: "Anders" });
    const prefix = "Muster";
    anders.fire("CHAT_MSG_ADDON", prefix, "S1;7;1;2;20;MAGE;1,2", "PARTY", "Bo-Firemaw");
    anders.fire("CHAT_MSG_ADDON", prefix, "S1;8;1;1;21;MAGE;5", "PARTY", "Bo-Firemaw");
    anders.fire("CHAT_MSG_ADDON", prefix, "S1;7;2;2;20;MAGE;3,4", "PARTY", "Bo-Firemaw");
    expect(anders.peers()["Bo-Firemaw"]).toMatchObject({ level: 21, quests: [5] });
  });
});
