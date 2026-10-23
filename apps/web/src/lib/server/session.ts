// Website sessions (architecture §5, B1). The cookie holds a random token; D1 stores only its hash.
import type { AstroCookies } from "astro";
import { schema, type Db } from "@party/db";
import { eq } from "drizzle-orm";
import { DAY } from "@party/domain";
import { randomToken, sha256Hex } from "./crypto.ts";

export const SESSION_COOKIE = "session";
const SESSION_LIFETIME = 30 * DAY;
const RENEW_WHEN_LEFT = 15 * DAY;

export type SessionUser = {
  id: string;
  displayName: string;
  timezone: string | null;
  defaultSessionMinutes: number;
};

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const expiresAt = Date.now() + SESSION_LIFETIME;
  await db.insert(schema.authSessions).values({ id: await sha256Hex(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the session's user, or null. Renews sessions that are past half their lifetime. */
export async function validateSession(
  db: Db,
  token: string,
): Promise<{ user: SessionUser; expiresAt: number } | null> {
  const id = await sha256Hex(token);
  const row = await db
    .select({
      expiresAt: schema.authSessions.expiresAt,
      id: schema.users.id,
      displayName: schema.users.displayName,
      timezone: schema.users.timezone,
      defaultSessionMinutes: schema.users.defaultSessionMinutes,
    })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(eq(schema.authSessions.id, id))
    .get();
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt <= now) {
    await db.delete(schema.authSessions).where(eq(schema.authSessions.id, id));
    return null;
  }
  let expiresAt = row.expiresAt;
  if (expiresAt - now < RENEW_WHEN_LEFT) {
    expiresAt = now + SESSION_LIFETIME;
    await db.update(schema.authSessions).set({ expiresAt }).where(eq(schema.authSessions.id, id));
  }
  const { expiresAt: _, ...user } = row;
  return { user, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(schema.authSessions).where(eq(schema.authSessions.id, await sha256Hex(token)));
}

export function setSessionCookie(cookies: AstroCookies, url: URL, token: string, expiresAt: number): void {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/app";
}
