// Characters: name, faction, class and level, typed in by the player. One of them is their main,
// which groups see next to their name.
import { WOW_CLASSES, schema, type Db } from "@muster/db";
import { and, eq, inArray } from "drizzle-orm";
import { UserError } from "./users.ts";

export type Character = typeof schema.characters.$inferSelect;
export type WowClass = (typeof WOW_CLASSES)[number];
export type MainCharacter = Pick<Character, "name" | "faction" | "class" | "level">;

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
  input: { id?: string; name: string; realm: string; faction: string; class: string; level: number; isMain: boolean },
): Promise<void> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 24) throw new UserError("Character names are 2 to 24 characters.");
  const faction = input.faction === "alliance" ? "alliance" : input.faction === "horde" ? "horde" : null;
  if (!faction) throw new UserError("Pick Alliance or Horde.");
  const cls = WOW_CLASSES.find((c) => c === input.class);
  if (!cls) throw new UserError("Pick a class.");
  const level = checkLevel(input.level);
  const realm = input.realm.trim().slice(0, 40) || null;

  const existing = await listCharacters(db, userId);
  if (input.id && !existing.some((c) => c.id === input.id)) throw new UserError("That character isn't yours.");
  if (!input.id && existing.length >= MAX_CHARACTERS) throw new UserError(`You can have up to ${MAX_CHARACTERS} characters.`);
  const same = (c: Character) => c.name.toLowerCase() === name.toLowerCase() && (c.realm ?? "") === (realm ?? "");
  if (existing.some((c) => c.id !== input.id && same(c))) throw new UserError(`You already have a character called ${name}.`);
  // The first character is always the main.
  const isMain = input.isMain || existing.length === 0 || (existing.length === 1 && existing[0]!.id === input.id);

  const values: Omit<typeof schema.characters.$inferInsert, "id" | "userId"> = {
    name,
    realm,
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
    })
    .from(schema.characters)
    .where(and(inArray(schema.characters.userId, userIds), eq(schema.characters.isMain, true)));
  return new Map(rows.map(({ userId, ...character }) => [userId, character]));
}

export function describeCharacter(c: MainCharacter): string {
  return `${c.faction === "alliance" ? "Alliance" : "Horde"} ${CLASS_NAMES[c.class]} · ${c.level}`;
}
