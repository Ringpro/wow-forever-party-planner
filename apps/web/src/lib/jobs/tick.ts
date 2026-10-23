// Runs every minute from the cron trigger. Each job must be idempotent (docs/architecture.md §8).
import { createDb } from "@party/db";
import { refreshAllBoards } from "../server/boards.ts";

export async function runTick(env: Env, _scheduledTime: number): Promise<void> {
  await refreshAllBoards(createDb(env.DB));
}
