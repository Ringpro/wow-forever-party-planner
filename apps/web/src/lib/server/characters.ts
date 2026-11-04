// Characters: name, faction, class, level, roles and realm type, typed in by the player. One of
// them is their main, which groups see next to their name.
import { REALM_TYPES, ROLES, WOW_CLASSES, schema, type Db } from "@muster/db";
import { and, eq, inArray } from "drizzle-orm";
import { UserError } from "./users.ts";

export type Character = typeof schema.characters.$inferSelect;
export type WowClass = (typeof WOW_CLASSES)[number];
export type Role = (typeof ROLES)[number];
export type RealmType = (typeof REALM_TYPES)[number];
export type MainCharacter = Pick<Character, "name" | "faction" | "class" | "level" | "roles" | "realmType">;

export const MAX_LEVEL = 60;
const MAX_CHARACTERS = 20;

export const CLASS_NAMES: Record<WowClass, string> = {
  warrior: "Warrior",
  paladin: "Paladin",
  hunter: "Hunter",
  rogue: "Rogue",
  priest: "Priest",
  shaman: "Shaman",
  mage: "Mage",
  warlock: "Warlock",
  druid: "Druid",
};

export const ROLE_NAMES: Record<Role, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };

export const REALM_TYPE_NAMES: Record<RealmType, string> = {
  pvp: "PvP",
  pve: "PvE",
  rp_pvp: "RP-PvP",
  rp_pve: "RP-PvE",
};

/** The roles each class can fill in classic-style WoW. */
export const CLASS_ROLES: Record<WowClass, readonly Role[]> = {
  warrior: ["tank", "dps"],
  paladin: ["tank", "healer", "dps"],
  hunter: ["dps"],
  rogue: ["dps"],
  priest: ["healer", "dps"],
  shaman: ["healer", "dps"],
  mage: ["dps"],
  warlock: ["dps"],
  druid: ["tank", "healer", "dps"],
};

export function rolesOf(character: Pick<Character, "roles">): Role[] {
  return ROLES.filter((r) => character.roles.split(",").includes(r));
}

/** Blizzard's class colours, used for a small dot next to names. */
export const CLASS_COLORS: Record<WowClass, string> = {
  warrior: "#C69B6D",
  paladin: "#F48CBA",
  hunter: "#AAD372",
  rogue: "#FFF468",
  priest: "#FFFFFF",
  shaman: "#0070DD",
  mage: "#3FC7EB",
  warlock: "#8788EE",
  druid: "#FF7C0A",
};

export async function listCharacters(db: Db, userId: string): Promise<Character[]> {
  const rows = await db.select().from(schema.characters).where(eq(schema.characters.userId, userId));
  return rows.sort((a, b) => Number(b.isMain) - Number(a.isMain) || b.level - a.level || a.name.localeCompare(b.name));
}

function checkLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new UserError(`Level must be 1 to ${MAX_LEVEL}.`);
  return level;
}

/** Adds a character, or updates one of the user's own when `id` is given. */
export async function saveCharacter(
  db: Db,
  userId: string,
  input: {
    id?: string;
    name: string;
    realmType: string;
    roles: readonly string[];
    faction: string;
    class: string;
    level: number;
    isMain: boolean;
  },
): Promise<void> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 24) throw new UserError("Character names are 2 to 24 characters.");
  const faction = input.faction === "alliance" ? "alliance" : input.faction === "horde" ? "horde" : null;
  if (!faction) throw new UserError("Pick Alliance or Horde.");
  const cls = WOW_CLASSES.find((c) => c === input.class);
  if (!cls) throw new UserError("Pick a class.");
  const level = checkLevel(input.level);
  const realmType = REALM_TYPES.find((r) => r === input.realmType) ?? null;
  if (input.realmType && !realmType) throw new UserError("Pick a realm type.");
  const allowed = CLASS_ROLES[cls];
  // A class with one role always has it; others need at least one picked.
  if (input.roles.some((r) => !allowed.includes(r as Role))) {
    throw new UserError(`${CLASS_NAMES[cls]}s can be ${allowed.map((r) => ROLE_NAMES[r]).join(" or ")}.`);
  }
  const roles = allowed.length === 1 ? [...allowed] : allowed.filter((r) => input.roles.includes(r));
  if (roles.length === 0) throw new UserError(`Pick a role ${CLASS_NAMES[cls]}s can play.`);

  const existing = await listCharacters(db, userId);
  if (input.id && !existing.some((c) => c.id === input.id)) throw new UserError("That character isn't yours.");
  if (!input.id && existing.length >= MAX_CHARACTERS) throw new UserError(`You can have up to ${MAX_CHARACTERS} characters.`);
  const same = (c: Character) => c.name.toLowerCase() === name.toLowerCase();
  if (existing.some((c) => c.id !== input.id && same(c))) throw new UserError(`You already have a character called ${name}.`);
  // The first character is always the main.
  const isMain = input.isMain || existing.length === 0 || (existing.length === 1 && existing[0]!.id === input.id);

  const values: Omit<typeof schema.characters.$inferInsert, "id" | "userId"> = {
    name,
    realmType,
    roles: roles.join(","),
    faction,
    class: cls,
    level,
    isMain,
    source: "web",
    updatedAt: Date.now(),
  };
  const write = input.id
    ? db
        .update(schema.characters)
        .set(values)
        .where(and(eq(schema.characters.id, input.id), eq(schema.characters.userId, userId)))
    : db.insert(schema.characters).values({ id: crypto.randomUUID(), userId, ...values });
  if (isMain) {
    // Only one main: clear the flag everywhere, then write this one.
    await db.batch([db.update(schema.characters).set({ isMain: false }).where(eq(schema.characters.userId, userId)), write]);
  } else {
    await write;
  }
}

export async function deleteCharacter(db: Db, userId: string, id: string): Promise<void> {
  const characters = await listCharacters(db, userId);
  const target = characters.find((c) => c.id === id);
  if (!target) return;
  await db.delete(schema.characters).where(and(eq(schema.characters.id, id), eq(schema.characters.userId, userId)));
  const next = characters.find((c) => c.id !== id);
  if (target.isMain && next) {
    await db.update(schema.characters).set({ isMain: true }).where(eq(schema.characters.id, next.id));
  }
}

/** Sets the level of the user's main character (for `/level` in Discord). Returns the character. */
export async function setMainLevel(db: Db, userId: string, level: number, source: "web" | "discord"): Promise<Character> {
  const main = (await listCharacters(db, userId)).find((c) => c.isMain);
  if (!main) throw new UserError("Add a character on the website first, then use /level.");
  checkLevel(level);
  await db.update(schema.characters).set({ level, source, updatedAt: Date.now() }).where(eq(schema.characters.id, main.id));
  return { ...main, level };
}

/** Main characters for a set of users, for showing next to their names. */
export async function mainCharacters(db: Db, userIds: string[]): Promise<Map<string, MainCharacter>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: schema.characters.userId,
      name: schema.characters.name,
      faction: schema.characters.faction,
      class: schema.characters.class,
      level: schema.characters.level,
      roles: schema.characters.roles,
      realmType: schema.characters.realmType,
    })
    .from(schema.characters)
    .where(and(inArray(schema.characters.userId, userIds), eq(schema.characters.isMain, true)));
  return new Map(rows.map(({ userId, ...character }) => [userId, character]));
}

export function describeCharacter(c: MainCharacter): string {
  const roles = rolesOf(c).map((r) => ROLE_NAMES[r]).join(", ");
  return `${c.faction === "alliance" ? "Alliance" : "Horde"} ${CLASS_NAMES[c.class]} · ${c.level}${roles ? ` · ${roles}` : ""}`;
}
