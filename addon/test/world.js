// Runs the real addon files in several simulated WoW clients (one Lua VM each) and passes
// addon messages between players who are in the same group.
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";

const ADDON = new URL("../Muster/", import.meta.url);
const FAKE_WOW = readFileSync(new URL("fake-wow.lua", import.meta.url), "utf8");
const FILES = readFileSync(new URL("Muster.toc", ADDON), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((file) => [file, readFileSync(new URL(file, ADDON), "utf8")]);

const factory = new LuaFactory();

/** Turns plain JS data into a Lua expression. */
function lua(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(",")}}`;
  return `{${Object.entries(value)
    .map(([k, v]) => `[${/^\d+$/.test(k) ? k : JSON.stringify(k)}]=${lua(v)}`)
    .join(",")}}`;
}

export async function createWorld() {
  const players = new Map();
  const queue = [];

  class Player {
    constructor(engine, name, realm) {
      this.engine = engine;
      this.name = name;
      this.realm = realm;
      this.fullName = `${name}-${realm}`;
      this.groupId = null;
    }
    run(code) {
      return this.engine.doStringSync(code);
    }
    /** Evaluates a Lua expression and returns it as plain JS data. */
    get(expression) {
      return JSON.parse(this.run(`return Fake.Json(${expression})`));
    }
    set(path, value) {
      this.run(`${path} = ${lua(value)}`);
    }
    fire(event, ...args) {
      this.run(`Fake.Fire(${[JSON.stringify(event), ...args.map(lua)].join(",")})`);
    }
    slash(input) {
      return this.run(`return Fake.Slash(${JSON.stringify(input)})`);
    }
    setQuests(quests) {
      this.set(
        "Fake.quests",
        quests.map((q) => ({ questID: q.id, title: q.title ?? `Quest ${q.id}`, level: q.level ?? 20, isComplete: q.done ?? false, isHeader: q.header ?? false, isHidden: q.hidden ?? false })),
      );
    }
    sent() {
      return this.get("Fake.sent");
    }
    /** The addon's view of other players, with quest-ID sets turned into sorted lists in Lua. */
    peers() {
      const peers = this.get(`(function()
        local out = {}
        for sender, p in pairs(ADDON_NS.peers) do
          local ids = {}
          for id in pairs(p.quests) do ids[#ids + 1] = id end
          table.sort(ids)
          out[sender] = { level = p.level, class = p.class, seenAt = p.seenAt, quests = ids }
        end
        return out
      end)()`);
      return Array.isArray(peers) ? {} : peers;
    }
  }

  async function addPlayer({ name, realm = "Firemaw", level = 20, class: cls = "WARRIOR", quests = [], groupId, kind = "PARTY" }) {
    const engine = await factory.createEngine();
    const player = new Player(engine, name, realm);
    engine.global.set("__deliver", (prefix, msg, channel) => queue.push({ from: player, prefix, msg, channel }));
    engine.doStringSync(FAKE_WOW);
    player.set("Fake.player.name", name);
    player.set("Fake.player.realm", realm);
    player.set("Fake.player.level", level);
    player.set("Fake.player.class", cls);
    player.setQuests(quests);
    for (const [file, source] of FILES) {
      engine.global.set("__source", source);
      engine.doStringSync(`Fake.Load(${JSON.stringify(file)}, __source)`);
    }
    players.set(name, player);
    if (groupId) {
      // Logging in (or /reload) while already in a group: no roster update fires for us.
      player.groupId = groupId;
      refreshMembers(groupId, kind);
    }
    player.fire("ADDON_LOADED", "Muster");
    player.fire("PLAYER_LOGIN");
    return player;
  }

  /** Delivers queued messages to everyone else in the sender's group, until none are left. */
  function flush() {
    while (queue.length > 0) {
      const { from, prefix, msg, channel } = queue.shift();
      if (!from.groupId) continue;
      for (const to of players.values()) {
        if (to.groupId === from.groupId) to.fire("CHAT_MSG_ADDON", prefix, msg, channel, from.fullName);
      }
    }
  }

  /** Moves every client's clock forward one second at a time, delivering messages in between. */
  function advance(seconds = 10) {
    for (let i = 0; i < seconds; i++) {
      for (const p of players.values()) p.run("Fake.Advance(1)");
      flush();
    }
  }

  function refreshMembers(groupId, kind) {
    const members = [...players.values()].filter((p) => p.groupId === groupId);
    if (members.length === 1) {
      // A group of one disbands, like in the game.
      members[0].groupId = null;
      members[0].set("Fake.group", null);
      members[0].set("Fake.members", {});
      return members;
    }
    for (const p of members) {
      p.set("Fake.group", kind);
      p.set(
        "Fake.members",
        Object.fromEntries(members.filter((m) => m !== p).map((m) => [m.realm === p.realm ? m.name : m.fullName, true])),
      );
    }
    return members;
  }

  /** Puts players in a group (or adds them to an existing one) and fires roster updates. */
  function group(names, { id = "g1", kind = "PARTY" } = {}) {
    for (const name of names) players.get(name).groupId = id;
    for (const p of refreshMembers(id, kind)) p.fire("GROUP_ROSTER_UPDATE");
  }

  function leave(name) {
    const p = players.get(name);
    const id = p.groupId;
    const kind = p.get("Fake.group");
    p.groupId = null;
    p.set("Fake.group", null);
    p.set("Fake.members", {});
    p.fire("GROUP_ROSTER_UPDATE");
    for (const m of refreshMembers(id, kind)) m.fire("GROUP_ROSTER_UPDATE");
  }

  function close() {
    for (const p of players.values()) p.engine.global.close();
  }

  return { addPlayer, group, leave, advance, flush, players, close };
}
