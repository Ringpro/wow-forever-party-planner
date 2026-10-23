import { defineConfig } from "drizzle-kit";

// Generates SQL migrations only. They are applied with `wrangler d1 migrations apply`
// (see apps/web/package.json), so drizzle-kit never needs database credentials.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
