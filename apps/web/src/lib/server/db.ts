import { env } from "cloudflare:workers";
import { createDb, type Db } from "@party/db";

let cached: Db | undefined;

export function getDb(): Db {
  cached ??= createDb(env.DB);
  return cached;
}
