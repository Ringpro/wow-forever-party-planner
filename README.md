# Party Planner (working title)

Less time planning. More time playing together.

A scheduling tool for small groups of WoW players: mark which evenings you can play from the website or Discord, and see when enough of the group overlaps.

**Stack:** Astro (server-rendered) + one Cloudflare Worker + D1, in a pnpm monorepo. See [docs/architecture.md](docs/architecture.md).

## Layout

| Path | What |
| --- | --- |
| `apps/web` | The Worker: website, Discord interactions endpoint, minute cron |
| `packages/domain` | Business rules: time zones, availability, best start time, sharing |
| `packages/db` | Drizzle schema and D1 migrations |
| `docs/` | Brief, PRD, architecture, distribution |

## Getting started

Needs Node 24 and pnpm 9.

```bash
pnpm install
```

```bash
pnpm db:migrate:local
```

```bash
pnpm dev
```

For the Discord parts, copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and fill in values from your Discord dev app.

Checks (the same ones CI runs):

```bash
pnpm typecheck
```

```bash
pnpm test
```

## Deploying (manual for now)

1. `npx wrangler d1 create party-planner` (from `apps/web`) and put the printed id into `apps/web/wrangler.jsonc`.
2. Set secrets: `npx wrangler secret put DISCORD_PUBLIC_KEY` (and `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`).
3. `pnpm db:migrate:remote`
4. `pnpm deploy`
5. In the Discord developer portal, set the Interactions Endpoint URL to `https://<your-worker>/api/discord/interactions`.

## Docs

| Doc | What's in it |
| --- | --- |
| [docs/product-brief.md](docs/product-brief.md) | The original concept: problem, vision, entities, phases |
| [docs/prd.md](docs/prd.md) | Requirements: decisions on open questions, MVP / next / later features with acceptance criteria |
| [docs/architecture.md](docs/architecture.md) | System design: components, trust boundaries, key flows, time handling, jobs, deployment |
| [docs/distribution.md](docs/distribution.md) | Getting the Discord app and WoW addon from the website |
