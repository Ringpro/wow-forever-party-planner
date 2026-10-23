import { refreshBoardsFor } from "./boards.ts";
import { getDb } from "./db.ts";

/** Updates affected Discord boards after the response is sent. The minute tick catches anything missed. */
export function refreshBoardsLater(locals: App.Locals, change: { userId?: string; groupIds?: string[] }): void {
  locals.cfContext.waitUntil(
    refreshBoardsFor(getDb(), change).catch((e) =>
      console.log(JSON.stringify({ event: "board_refresh_failed", error: String(e) })),
    ),
  );
}
