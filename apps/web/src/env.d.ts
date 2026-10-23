// Secrets aren't in wrangler.jsonc, so `wrangler types` only sees them when .dev.vars exists.
// Declaring them here keeps type checks working in CI.
declare namespace Cloudflare {
  interface Env {
    DISCORD_PUBLIC_KEY: string;
    DISCORD_BOT_TOKEN: string;
    DISCORD_CLIENT_SECRET: string;
  }
}

declare namespace App {
  interface Locals {
    user: import("./lib/server/session.ts").SessionUser | null;
  }
}
