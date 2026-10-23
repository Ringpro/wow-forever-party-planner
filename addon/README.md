# Party Planner addon (WoW Forever)

See which quests you share with your group. Works on its own; no website account needed.

> **Status:** v0.1, written against the documented WoW Forever (Mainline) API. Being tested on the beta; see the checklist in [docs/addon-feasibility.md](../docs/addon-feasibility.md).

## What it does

- Keeps a snapshot of your character (level, zone, active quests) in its saved variables.
- When you're in a group, shares your level, class and active quest IDs with members who also run the addon.
- `/pp` shows your status and who in the group runs the addon.
- `/pp shared` lists the quests you share with each of them, and the ones they have that you don't.
- `/pp share off` stops sharing (and tells others to forget your data); `/pp share on` turns it back on.

## Installing for development

Copy (or link) the `PartyPlanner` folder into your game's AddOns folder, so you end up with `.../Interface/AddOns/PartyPlanner/PartyPlanner.toc`. On the beta that's `World of Warcraft\_classic_beta_\Interface\AddOns\`. The live client's folder isn't known yet.

On Windows, a directory junction keeps the game in sync with the repo (no admin needed). In PowerShell:

```powershell
New-Item -ItemType Junction -Path "C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\PartyPlanner" -Target "C:\path\to\repo\addon\PartyPlanner"
```

Then `/reload` in game after each change.

## Checks

No WoW client needed:

```bash
pnpm --filter @party/addon test
```

It checks that every file in the TOC parses as Lua 5.1 and that no file leaks global variables.
