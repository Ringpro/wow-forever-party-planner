// The regular member check: people who left a Discord server leave its group and squads, and
// names follow Discord. Discord's API is faked here.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@muster/db";

class FakeDiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
  ) {
    super(`Discord ${status}`);
  }
}
const guildMembers = new Map<
  string,
  { roles: string[]; nick?: string | null; user: { id: string; username: string; global_name: string | null } }
>();
vi.mock("../src/lib/discord/api.ts", () => ({
  DiscordApiError: FakeDiscordApiError,
  discordApi: vi.fn(async (_method: string, path: string) => {
    const discordId = path.split("/").pop()!;
    const member = guildMembers.get(discordId);
    if (!member) throw new FakeDiscordApiError(404, 10007);
    return member;
  }),
}));

const { checkServerMembers } = await import("../src/lib/server/discord-sync.ts");
const { createSquad, ensureServerGroup, listMyGroups, syncServerMemberships, syncSquadMemberships } = await import(
  "../src/lib/server/groups.ts"
);
const { getUser } = await import("../src/lib/server/users.ts");
const { groupWeek } = await import("../src/lib/server/availability.ts");
const { createTestDb, createUser } = await import("./db.ts");

const CPH = "Europe/Copenhagen";
let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, dispose } = await createTestDb());
});

afterAll(async () => {
  await dispose();
});

describe("checkServerMembers", () => {
  it("drops people who left the server, keeps the rest, and follows their Discord names", async () => {
    const ringbo = await createUser(db, "Ringbo", CPH);
    const coffee = await createUser(db, "MoreCoffee", CPH);
    const server = await ensureServerGroup(db, { guildId: "999", name: "Aftenholdet", iconUrl: null }, CPH);
    for (const u of [ringbo, coffee]) {
      await syncServerMemberships(db, u.id, [{ groupId: server.id, admin: u === ringbo }], {
        complete: false,
        shareByDefault: true,
      });
    }
    const squad = await createSquad(db, ringbo.id, server.id, { name: "Raid", roleId: "123456" });
    await syncSquadMemberships(db, coffee.id, server.id, ["123456"]);
    expect((await listMyGroups(db, coffee.id)).map((g) => g.id).sort()).toEqual([server.id, squad].sort());

    // MoreCoffee left the server; Ringbo renamed himself in Discord.
    guildMembers.set("test-Ringbo", { roles: [], user: { id: "test-Ringbo", username: "ringbo", global_name: "Ringo" } });

    expect(await checkServerMembers(db, server.id, "999")).toBe(true);
    expect(await listMyGroups(db, coffee.id)).toEqual([]);
    expect((await listMyGroups(db, ringbo.id)).map((g) => g.id)).toContain(server.id);
    expect((await getUser(db, ringbo.id))?.displayName).toBe("Ringo");

    // Nothing new: nothing changes.
    expect(await checkServerMembers(db, server.id, "999")).toBe(false);
  });

  it("shows server nicknames in the server and its squads, but not elsewhere", async () => {
    const jonas = await createUser(db, "Jonas", CPH);
    const server = await ensureServerGroup(db, { guildId: "888", name: "Nicks", iconUrl: null }, CPH);
    await syncServerMemberships(db, jonas.id, [{ groupId: server.id, admin: true }], { complete: false, shareByDefault: true });
    const squad = await createSquad(db, jonas.id, server.id, { name: "Raid", roleId: "654321" });
    guildMembers.set("test-Jonas", {
      roles: ["654321"],
      nick: "Bo",
      user: { id: "test-Jonas", username: "jonas", global_name: "Jonas" },
    });

    expect(await checkServerMembers(db, server.id, "888")).toBe(true);
    expect((await groupWeek(db, jonas, server.id))!.members.map((m) => m.displayName)).toEqual(["Bo"]);
    expect((await groupWeek(db, jonas, squad))!.members.map((m) => m.displayName)).toEqual(["Bo"]);
    expect((await getUser(db, jonas.id))?.displayName).toBe("Jonas");

    // Clearing the nickname in Discord goes back to their Discord name.
    guildMembers.set("test-Jonas", { roles: ["654321"], nick: null, user: { id: "test-Jonas", username: "jonas", global_name: "Jonas" } });
    expect(await checkServerMembers(db, server.id, "888")).toBe(true);
    expect((await groupWeek(db, jonas, server.id))!.members.map((m) => m.displayName)).toEqual(["Jonas"]);
  });
});
