# herdr Tickets for Jira: plan

## Why

Written 2026-10-01.

The Stream Deck+ arrived this morning and two standalone plugins already run on it (usage gauges, herdr Control). Hardy wants a third: Jira tickets on the deck, sent into herdr as a new agent session. A Jira plugin for Stream Deck already exists, but it doesn't talk to herdr, and herdr is the point.

This is the "send a Jira ticket to Claude" feature from the Deckhand page (Obsidian: `Crazy Ideas/Stream Deck Plus Control Deck.md`), built as its own plugin under the one-idea-per-plugin rule: own repo, own plugin ID, zero setup for a stranger, Marketplace-minded.

What changed from the Deckhand page (2026-09-30 layout):

- **A status key** is new: it counts my in-sprint tickets in one status and opens the matching Jira search.
- **Press the ticket dial twice to send**, not a separate "Work ticket" key. The page dropped press-twice because a bumped dial could send. Cancel-on-turn plus a 3 s timeout answers that (Hardy, 2026-10-01).
- **"Active" means in an open sprint**, not "assigned and not done".
- **No repo map, no busy-repo check.** Sessions start in one configurable folder; Hardy works out of his git repos folder (`~/code`), and `/work-ticket` finds the repo from the key.
- **No deckhand dependency.** The Jira client and the herdr send are copied from `~/code/deckhand` (which has no remote) and from herdr Control, so the plugin stands alone.

## Decisions (Hardy, 2026-10-01)

| # | Decision |
| --- | --- |
| D1 | Scope: assigned to me, in an open sprint (`sprint in openSprints()`). Both dials show only To Do tickets (status category `new`), so an in-progress ticket can't be sent twice. The status key can count any status, Done included |
| D2 | The status key follows the project chosen on dial 1 by default; a setting can pin it to one project |
| D3 | A send behaves like herdr Control's New Tab: focus the new tab, then bring the chosen terminal app forward (shared "Terminal app" picker and "Bring forward" checkbox, default on) |
| D4 | Plugin ID `com.boxofraccoons.jira-herdr`, name "herdr Tickets for Jira" (Atlassian's brand rules want "for Jira", and the ID can't change once installed) |
| D5 | Tapping the ticket on the strip opens it in Jira |
| D6 | Credentials: site and email in global settings, API token in the macOS Keychain (Deckhand D12; global settings aren't documented as encrypted) |
| D7 | Sessions start in a configurable folder, default `~` |

## Actions

**Status key.** Shows the count of my open-sprint tickets in the chosen status, colored by status category, with the status name as caption and the project (or "All") on top. The status dropdown is filled from Jira (`/rest/api/3/status`, deduped by name). Press opens `https://<site>/issues/?jql=...` with the same query in the default browser.

**Project dial (dial 1).** Turn previews: "All" first, then each project with To Do tickets in an open sprint, with its count. Press or tap commits. After 5 s without a press it snaps back to the committed project, as herdr Control's dials do. The committed project is kept in global settings so it survives a restart.

**Ticket dial (dial 2).** Turn scrolls the committed project's To Do tickets: key, status color, shortened summary. The first press arms ("press again to send"); a second press within 3 s sends; a turn or the timeout disarms. Tap opens the ticket in Jira. Settings: prompt template (default `/work-ticket {key}`; `{key}`, `{summary}`, `{url}`), start folder, agent kind (default claude).

**Send** (same order as deckhand, herdr socket API):

1. `session.snapshot`; refuse if a live agent already has this ticket's name (a double send before the next refresh).
2. `tab.create {workspace_id: focused, cwd, label: KEY, focus: true}`.
3. `agent.start {name: key-lowercased, kind, pane_id, timeout_ms: 90000}`.
4. Poll `agent.get` until `interactive_ready` and not `launch_pending` (90 s cap); refuse if the agent is `blocked` (a dialog in its tab). Added during the build, see Status.
5. `agent.prompt {target: name, text}`.
6. Bring the terminal app forward; refresh tickets about 20 s later.

On a failed step: alert, log, leave the tab for inspection, never retry a prompt.

## Shared ticket service

One service holds the ticket list for every action, so a page swipe never shows an empty list. One JQL (`assignee = currentUser() AND sprint in openSprints() ORDER BY Rank ASC`, fields `summary,status,project`) feeds all three actions. Refresh every 60 s while any action is visible, and on a dial touch when the list is over 10 s old. Back off on errors, up to 10 min. Errors show on the strip and key: "set up Jira" (no credentials), "token rejected" (401/403), "Jira unreachable".

## How to verify

- Logic lives outside the SDK classes and is unit tested with vitest: Jira paging and errors, filtering and counts, status-key JQL and URL, dial browsing, arm/send/disarm, the send sequence against a recording `call`, the Keychain commands against a stub. Every test seen red once (mutation pass with a no-op control).
- `pnpm check`, `pnpm build`, `streamdeck validate`.
- Real Jira: a script runs the scope query and prints what each action would show.
- Real herdr: one send from a script with a harmless prompt and focus off (so Hardy's screen doesn't jump), then close that tab. Never with the default `/work-ticket` prompt.
- Keychain round trip on this Mac with a throwaway service name.
- Dials need Hardy's hands on the device.

## Rules

- Local repo, `develop` integration branch, feature branch merged `--no-ff`. No GitHub remote or push until Hardy says so.
- Stage named paths. No AI attribution in commits.
- Jira: reads only.

## Status (2026-10-01, end of the build session)

Built on `feature/jira-actions`, merged to `develop`: the three actions, the shared ticket service, Keychain token storage, the settings panels, images, CI and release workflows copied from herdr Control. 77 tests. A mutation pass (with a no-op control that survived, as it must) caught every mutant but one equivalent one: `readToken` skipping its exit-code check still returns null, because a missing item prints nothing.

Checked for real:

- Jira: `scripts/preview.mts` against my home Jira: 28 tickets in open sprints, 7 To Do (GYM 4, MP 1, SDTB 2). WF has none in an open sprint (Kanban), as expected.
- herdr: a send of SDTB-2 with a harmless prompt and focus off. It worked after one fix (below), the duplicate send was refused, and the test tab was closed.
- Keychain: add, update, read and the not-found exit code (44), with a throwaway item, deleted afterward.

Found while building:

- **Over the socket, `agent.start` does not wait for the agent.** It returns in about 100 ms with `launch_pending: true`, and `agent.prompt` then fails with `agent_not_ready` ("not an active named agent"). The CLI's `herdr agent start` waits; the socket method doesn't. Fixed by polling `agent.get` (about 4 s for Claude here). Regression test seen red with the fix reverted.
- `security -i` returns the failed command's exit status, so a failed save is detectable.
- A credentials change while a fetch is in flight: the old answer is thrown away so the old site's tickets never show, even briefly.

Open:

- Nothing has run on the device: the panels (token box, status dropdown), dial feel, strip text fit, key image. Needs Hardy.
- The SDTB test board shows on the dials (deckhand refused it). No refuse list here; add one if it gets in the way.
- Jira scoped API tokens (api.atlassian.com/ex/jira/{cloudId}) aren't supported, only classic tokens on the site URL.
- No token-expiry warning yet.
- No GitHub remote; nothing pushed.
