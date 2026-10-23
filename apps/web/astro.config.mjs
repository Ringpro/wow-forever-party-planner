// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  // We keep our own login sessions in D1, and serve no images that need processing,
  // so the adapter doesn't need its default KV and Images bindings.
  session: false,
  // Lets Discord reach `pnpm dev` through a Cloudflare quick tunnel. Only affects dev/preview.
  server: { allowedHosts: [".trycloudflare.com"] },
  adapter: cloudflare({ imageService: "passthrough" }),
});
