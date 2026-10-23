import type { APIRoute } from "astro";
import { getDb } from "../../lib/server/db.ts";
import { SESSION_COOKIE, clearSessionCookie, deleteSession } from "../../lib/server/session.ts";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  clearSessionCookie(cookies);
  return redirect("/");
};
