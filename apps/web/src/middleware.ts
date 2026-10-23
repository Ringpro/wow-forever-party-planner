import { defineMiddleware } from "astro:middleware";
import { getDb } from "./lib/server/db.ts";
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie, validateSession } from "./lib/server/session.ts";

// Pages that need a logged-in user. Everything else is public.
const PROTECTED = ["/app", "/groups", "/join", "/onboarding"];

export const onRequest = defineMiddleware(async ({ url, cookies, locals, redirect }, next) => {
  locals.user = null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_astro/")) return next();

  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await validateSession(getDb(), token);
    if (session) {
      locals.user = session.user;
      setSessionCookie(cookies, url, token, session.expiresAt);
    } else {
      clearSessionCookie(cookies);
    }
  }

  const isProtected = PROTECTED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  if (!isProtected) return next();

  if (!locals.user) {
    return redirect(`/auth/discord?return_to=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (!locals.user.timezone && url.pathname !== "/onboarding") {
    return redirect(`/onboarding?return_to=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return next();
});
