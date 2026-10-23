# Party Planner — Product Requirements (PRD)

> Source: [product-brief.md](product-brief.md). Architecture: [architecture.md](architecture.md). Distribution: [distribution.md](distribution.md).
>
> **Status:** Draft v0.1, 2026-10-23. Decisions marked *(proposed)* are defaults so work can start. Change them here if the founders disagree.

## 1. Summary

A scheduling tool for small groups of WoW players with little and unpredictable free time. People mark which evenings they can play, from the website or from Discord, in a few taps. The group sees which nights work and the earliest time enough people overlap. One person can be in several groups and choose what each group sees.

Characters, discovery and the WoW addon come later. The first release has to be useful with **no game integration at all**.

## 2. Goals and non-goals

### Goals for the first release (MVP)
- The Dads (six people) plan the coming week without chasing each other in chat.
- Updating availability takes **under 10 seconds** on a phone, from Discord or the website.
- The group can see at a glance which nights have enough players and from what time.
- Multi-group and per-group sharing work from day one.

### Non-goals for the MVP
Characters, levels, quests, the WoW addon, player discovery across groups, public matchmaking, native mobile apps, voice, analytics dashboards. (See §6 and §7 for when they come in.)

## 3. Decisions on the brief's open questions

| # | Question (brief §13) | Decision |
| --- | --- | --- |
| 1 | What is "WoW Forever"? | **Still open.** Doesn't block the MVP. Must be answered before Phase 2 character fields are finalized and before any addon work. |
| 2 | One server/ruleset/faction? | Assume it varies. Characters store version/ruleset, realm and faction (Phase 2). |
| 3 | Start time only or windows? | *(proposed)* **Start time required for Yes/Maybe, end time optional.** No end time means the user's default session length (default 2 h). Windows can cross midnight (21:30–00:30). |
| 4 | Carry over last week automatically? | *(proposed)* **No silent carry-over.** Explicit weekly defaults, plus a one-tap "Copy this week to next week". |
| 5 | Private by default? | *(proposed)* Availability is only visible to groups it's shared with. Joining a group asks once, "Share your availability with this group?" (pre-checked, since joining shows intent). Can be turned off per group at any time. |
| 6 | Discord model | *(proposed)* **One app with both install types**: server install for the group board, user install for personal commands anywhere. See [distribution.md](distribution.md). |
| 7 | Character identity | Phase 2/3. MVP has no characters. |
| 8 | Addon data sharing | Phase 3 feasibility spike. |
| 9 | Discoverability | *(proposed)* **Invite-only in the MVP.** No discovery across groups until Phase 2. |
| 10 | Notifications | *(proposed)* Everything opt-in except direct replies to your own actions. Starting set in M10. |
| 11 | Addon channels | Phase 3: website download plus CurseForge/Wago. |

## 4. Users

| Persona | Needs | Main surface |
| --- | --- | --- |
| **Busy parent** (core user) | Mark tonight/this week fast, change plans late, see if it's worth logging in | Discord on phone |
| **Group organizer** | Create a group, invite people, see which night to pick, set up the board | Website, then Discord |
| **Multi-group member** | Be in The Dads and Work Guild, share selectively, enter things once | Website + Discord |
| **Discord-only user** | Never open the website, still take part fully | Discord |
| **Website-only user** | Not on Discord (or not in that server), still take part | Website |

## 5. MVP requirements (Phase 1: must have)

Each requirement has an ID for tracking. "AC" = acceptance criteria.

### M1. Accounts and identity
- Log in with **Discord OAuth**. An email login comes later (every pilot user is on Discord; architecture A11).
- **Discord-only users** are created automatically on their first interaction with the bot. Logging in on the website with Discord later opens the same profile.
- Timezone: detected from the browser on the website; on Discord, asked once on first use (picker with common zones plus search). Can be changed in settings.
- Display name, defaulting to the Discord name.
- **AC:** A new user who only uses Discord can set their timezone and mark availability without visiting the website. Logging in on the website with the same Discord account shows the same data.

### M2. Groups
- Create a group (name, display timezone, minimum players, default "evening" range for the board, e.g. 19:00–01:00).
- Invite by link: random token, can be revoked, optional expiry and max uses.
- Join, leave, and see "my groups". Roles: **admin** and **member**. The creator is an admin; admins can promote others and remove members.
- A user can be in any number of groups.
- **AC:** A user in two groups switches between them in one tap. Leaving a group removes their data from that group's views immediately.

### M3. Availability entry
- For each local date: **Yes / Maybe / No**, a start time (presets 20:00 / 20:30 / 21:00 / 21:30 plus custom) and an optional end time.
- No entry is different from "No" and is shown as "unknown".
- Clear an entry.
- Every change records its source (`web`, `discord`, `weekly_default`) and time.
- **AC:** From the website on a phone, "Wednesday, Maybe, 20:30" takes three taps from the week view and under 10 s (user story 1).

### M4. Weekly defaults and exceptions
- Set a default per weekday (e.g. Tue Yes 21:00, Sat Maybe 20:00).
- Defaults fill future days that have no explicit entry. An explicit entry for a date always overrides the default for that date.
- "Copy this week to next week", in one tap.
- **AC:** Changing a default updates future days without explicit entries and leaves already-overridden dates alone. Defaults are shown in the UI as defaults (lighter style), not as fresh answers.

### M5. Sharing per group
- Each membership has a sharing switch: **share my availability with this group** (on/off).
- Each entry can be limited to selected groups ("only The Dads" this Thursday).
- Every place you edit availability shows **"Shared with: …"** (user story 3, 6).
- **AC:** Availability hidden from Work Guild never appears in any Work Guild view, Discord board or notification. Other members of Work Guild can't tell whether the user has hidden data or simply hasn't answered; both show as "unknown".

### M6. Group week view (website)
- A 7-day grid starting today: one row per member, cells showing status and time, with defaults styled differently from explicit answers.
- For each day: count of Yes / Maybe / unknown, and the **best start time** (see the rule in §5.1).
- "Enough players" marker when the group's minimum is reached; "full party" marker at 5.
- Times shown in the viewer's own timezone, with a note when a member's timezone differs.
- "Last updated" per member.
- **AC:** With the six dads' sample data the view correctly shows which nights hit the minimum and the best start time per night.

### M7. My schedule (website)
- My entries for the next 2 weeks across all groups, with sharing indicators. This is the main editing screen.
- Weekly defaults are edited here as well.

### M8. Discord app
Commands (all replies are **ephemeral**, i.e. only the user sees them, unless noted):

| Command | Does |
| --- | --- |
| `/avail` | Opens a personal week planner: pick a day, Yes/Maybe/No, start time. Works everywhere (user install). |
| `/play now [hours]` | Sets "free now" (M9). |
| `/delay <minutes>` | Moves today's start time (or the current session's) by N minutes. Shows the new time and the groups it's shared with. |
| `/who [day]` | Who's on today/that day in this server's group, or in all your groups when used outside a linked server. |
| `/board setup` | Admin only: links this channel to a group and posts the board. |
| `/settings` | Timezone, sharing per group, notifications. Links to the website for anything bigger. |

**Board message** (server install, in the linked channel, visible to everyone in the channel):
- The 7 days with counts and best start time per day.
- Buttons: **Plan my week** (opens the personal planner), **Free now**, **+30 min**, **Who's on?**.
- Updated within a few seconds of any change from web or Discord; moves forward one day at 05:00 in the group's timezone, so late sessions still count as "tonight" (architecture §7).
- Non-members who press a button get "Join *The Dads*?", which works only if the group admin has allowed joining from that channel; otherwise they're asked for an invite link.
- **AC:** User story 4. "+30 min" moves today's start from 20:30 to 21:00, and the board and website show 21:00 within 5 s. Pressing it twice by mistake doesn't move it to 21:30 (see architecture §6.3).

### M9. Free right now
- "Free now" status with an expiry (default 2 h, max until 03:00 local), separate from planned availability.
- Shown at the top of the website group view and on the board.
- Ends early with "Not free anymore".

### M10. Notifications (minimal, opt-in)
- **Free now ping**, per membership, off by default: "Mikkel is free to play now."
- **Tonight digest** in the board channel, per group, off by default, at a time the group chooses: "Tonight: 4 Yes, 1 Maybe, best start 21:00."
- **Fill in next week reminder**, per user, off by default: a Sunday DM if next week is empty.
- Hard limits: at most one free-now ping per sender per group every 2 h; no notifications between 00:00 and 08:00 local unless the user opts in.

### M11. Get the tools page
"Add to my server" and "Add to my account" buttons, a permissions list, and channel linking in onboarding. Details in [distribution.md](distribution.md) §1.

### M12. Privacy and account controls
- Delete account, which deletes availability, memberships and identities, and removes the user from all boards.
- Download my data (JSON).
- Privacy notice in plain language. **GDPR applies** as soon as this goes beyond a private circle of friends; host data in the EU and keep only what's needed.
- Data retention: past availability kept 90 days, then deleted.

### 5.1 Best start time rule
For a given group and local date:
1. Take every member sharing with the group who answered **Yes** for that date. Each answer is an interval [start, end), with end = start + default length if there's no end time.
2. Find the earliest time *t* at which at least `min_players` Yes intervals overlap for at least `min_overlap` (group setting, default 60 min).
3. If there's no such time with Yes only, repeat including **Maybe** and label it "possible with Maybes".
4. Otherwise show "not enough players".

This is the "earliest realistic common start time", not the earliest individual start. Unit tests must cover crossing midnight, DST changes and members in different timezones.

## 6. Next (Phase 2)

| ID | Feature |
| --- | --- |
| N1 | **Planned sessions with RSVP**: "Lock in Wed 21:00" from the best-start suggestion; RSVP Going/Maybe/Can't; separate from availability; posted to the board. *Candidate to pull into the MVP if the pilot asks for it.* |
| N2 | Manual characters: name, game version/ruleset, realm, faction, class, roles, level. `/level 42` in Discord. Source and timestamp shown. |
| N3 | Choose which characters each group sees. |
| N4 | Group character overview: levels, roles, level spread, outliers, freshness. |
| N5 | Friends (person-to-person), separate from groups. |
| N6 | Opt-in discovery: "3 compatible players free Thursday", with identities shown only if they allow it. |
| N7 | Session invitations across groups that don't reveal anyone's other groups or schedules. |

## 7. Later (Phase 3+)

| ID | Feature |
| --- | --- |
| L1 | WoW addon (after the feasibility spike on the confirmed client): own character and quest status locally. |
| L2 | Addon-to-addon sharing between participating players. |
| L3 | Addon download on the Get the tools page plus CurseForge/Wago. |
| L4 | Automatic level/progress sync (supported game API or companion app), if the spike shows it's feasible and allowed. |
| L5 | Quest overlap and catch-up views. |
| L6 | `/lfg <activity>` and activity preferences. |
| L7 | Recommendations: what should this party do tonight? |

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Mobile | Every MVP website screen works one-handed at 360 px wide. Tap targets ≥ 44 px. |
| Speed | Discord interactions acknowledged within Discord's 3 s limit, every time (deferred replies for anything slow). Website week view loads in under 1.5 s on 4G. |
| Time | All instants stored in UTC; local date, wall time and IANA timezone kept as well. Correct across DST changes. |
| Privacy | No data from one group visible in another unless the user shared it there. Enforced on the server, covered by tests. |
| Reliability | If Discord is down, the website still works and boards catch up afterwards. A failed board update is retried. |
| Cost | €0–10 per month for the first groups. |
| Accessibility | Status isn't shown by colour alone (icons/text too). Keyboard usable. |
| Language | English UI first; strings kept in one place so Danish can follow. |

## 9. Success metrics (4-week pilot with The Dads)

- **Coverage:** by Monday evening, at least 5 of 6 members have an answer for at least 5 of the next 7 days.
- **Speed:** median time to update an entry under 10 s (measured from interaction start to save).
- **Use:** at least 70 % of updates come from Discord. (If it's much lower, the Discord flows are too clunky.)
- **Outcome:** sessions actually played per week, as reported by the group, compared with the month before.
- **Qualitative:** fewer "who's on tonight?" chat messages; would the group keep using it?

## 10. Release plan

1. **Walking skeleton:** login, one group, availability entry on web, week view.
2. **Multi-group and sharing:** M2, M5, M7.
3. **Discord:** install, `/avail`, board, `/delay`, `/play now`.
4. **Defaults and notifications:** M4, M10.
5. **Pilot** with The Dads for 4 weeks, then decide on N1 and Phase 2.

The detailed milestones and tests come in the implementation plan (brief §14, item 7).

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| People don't keep entries up to date | Weekly defaults, Discord-first flows, optional Sunday reminder, "unknown" shown honestly. |
| Discord board is too noisy or too clunky on mobile | Ephemeral personal planner; single board message that gets edited, never re-posted; pilot feedback. |
| Privacy leak between groups | Server-side authorization in one place, test suite with cross-group leak cases (architecture §5). |
| "WoW Forever" turns out to be a private server with no APIs | MVP doesn't depend on it; addon is a separate spike. |
| Free hosting limits | Cloudflare Workers + D1 free tier doesn't pause when idle; Workers Paid ($5/month) if we hit the CPU limit. |

## 12. Still open

- What "WoW Forever" is (blocks Phase 2 character fields and Phase 3).
- Default minimum players for The Dads (3? 4?) and default evening range.
- Whether planned sessions (N1) are needed in the pilot.
- Product name.
