// Deleting an account removes everything about the user, and nothing about anyone else.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@muster/db";
import { eq } from "drizzle-orm";
import { addSlot, groupWeek, planningDays } from "../src/lib/server/availability.ts";
import { saveCharacter } from "../src/lib/server/characters.ts";
import { createGroup, getInviteToken, joinGroup } from "../src/lib/server/groups.ts";
import { deleteAccount } from "../src/lib/server/users.ts";
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

describe("deleteAccount", () => {
  it("removes the user's plans, characters, memberships and logins, and keeps the group for others", async () => {
    const anders = await createUser(db, "Anders", CPH);
    const bo = await createUser(db, "Bo", CPH);
    const group = await createGroup(db, anders.id, { name: "The Dads", timezone: CPH, minPlayers: 2 });
    await joinGroup(db, bo.id, await getInviteToken(db, anders.id, group), true);
    const today = planningDays(CPH)[0]!;
    await addSlot(db, anders, today, "web", "20:30", "yes");
    await addSlot(db, bo, today, "web", "21:00", "yes");
    await saveCharacter(db, anders.id, {
      name: "Thrallson",
      realmType: "",
      roles: ["dps"],
      faction: "horde",
      class: "mage",
      level: 20,
      isMain: true,
    });

    expect(await deleteAccount(db, anders.id)).toEqual([group]);

    const count = async (table: typeof schema.availabilityEntries | typeof schema.characters | typeof schema.userIdentities) =>
      (await db.select().from(table).where(eq(table.userId, anders.id))).length;
    expect(await count(schema.availabilityEntries)).toBe(0);
    expect(await count(schema.characters)).toBe(0);
    expect(await count(schema.userIdentities)).toBe(0);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, anders.id))).toEqual([]);

    const view = await groupWeek(db, bo, group, [today]);
    expect(view!.members.map((m) => m.displayName)).toEqual(["Bo"]);
    expect(view!.days[0]!.members[0]!.status).toBe("yes");
  });
});
