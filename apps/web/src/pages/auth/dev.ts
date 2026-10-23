// Local development only: log in as a fake Discord user without a Discord app.
// `import.meta.env.DEV` is false in every build, so this route always 404s when deployed.
import type { APIRoute } from "astro";
import { getDb } from "../../lib/server/db.ts";
import { createSession, safeReturnTo, setSessionCookie } from "../../lib/server/session.ts";
import { findOrCreateDiscordUser } from "../../lib/server/users.ts";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });

  const name = (url.searchParams.get("name") ?? "Dev").trim().slice(0, 40) || "Dev";
  const db = getDb();
  const userId = await findOrCreateDiscordUser(db, {
    id: `dev-${name.toLowerCase()}`,
    username: name.toLowerCase(),
    displayName: name,
  });
  const session = await createSession(db, userId);
  setSessionCookie(cookies, url, session.token, session.expiresAt);
  return redirect(safeReturnTo(url.searchParams.get("return_to")));
};
