// Runs every minute from the cron trigger. Jobs (board sweep, outbox, digests, cleanup)
// get added here; each must be idempotent (docs/architecture.md §8).
export async function runTick(_env: Env, scheduledTime: number): Promise<void> {
  console.log(JSON.stringify({ event: "tick", scheduledTime }));
}
