import { handle } from "@astrojs/cloudflare/handler";
import { runTick } from "./lib/jobs/tick.ts";

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runTick(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
