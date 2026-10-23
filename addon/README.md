# Party Planner addon (WoW Forever)

See which quests you share with your group. Works on its own; no website account needed.

> **Status:** v0.1, written against the documented WoW Forever (Mainline) API before launch. Not yet tested in-game; see the launch-day checklist in [docs/addon-feasibility.md](../docs/addon-feasibility.md).

## What it does

- Keeps a snapshot of your character (level, zone, active quests) in its saved variables.
- When you're in a group, shares your level, class and active quest IDs with members who also run the addon.
- `/pp` shows your status and who in the group runs the addon.
- `/pp shared` lists the quests you share with each of them, and the ones they have that you don't.
- `/pp share off` stops sharing (and tells others to forget your data); `/pp share on` turns it back on.

## Installing for development

Copy (or link) the `PartyPlanner` folder into your game's AddOns folder, so you end up with `.../Interface/AddOns/PartyPlanner/PartyPlanner.toc`. The WoW Forever client's folder name isn't confirmed yet; look for the `_forever_` (or similar) folder next to `_retail_` in your World of Warcraft install.

On Windows, a link keeps the game in sync with the repo (run in an admin or developer-mode terminal):

```bash
mklink /D "C:\Program Files (x86)\World of Warcraft\_forever_\Interface\AddOns\PartyPlanner" "C:\path\to\repo\addon\PartyPlanner"
```

Then `/reload` in game after each change.

## Checks

No WoW client needed:

```bash
pnpm --filter @party/addon test
```

It checks that every file in the TOC parses as Lua 5.1 and that no file leaks global variables.
