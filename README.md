# herdr Tickets for Jira

Your open-sprint Jira tickets on a Stream Deck, sent to [herdr](https://herdr.dev) as new
agent sessions. A key counts tickets by status; on a Stream Deck+, one dial picks the
project and the other picks a To Do ticket and sends it to a new herdr tab running Claude
(or another agent) with a prompt such as `/work-ticket GG-8`.

Requires Jira Cloud with sprints (Jira Software), herdr 0.9 (socket protocol 22),
Stream Deck 7.1 or later, and macOS 13 or later.

## Install

Download `com.boxofraccoons.jira-herdr.streamDeckPlugin` from the
[latest release](https://github.com/Box-of-Raccoons/streamdeck-jira-herdr/releases/latest)
and double-click it. To update, install a newer release the same way.

## Set up

Open any of the plugin's actions in the Stream Deck app and fill in **Jira site**
(`example.atlassian.net`) and **Email**. Paste an API token from
[your Atlassian account](https://id.atlassian.com/manage-profile/security/api-tokens) and
press **Save**. The token goes into your macOS login Keychain, not Stream Deck's settings,
and the panel confirms who you're connected as. Every action shares this setup.

## Actions

| Action | Where | What it does |
| --- | --- | --- |
| Status Count | key | How many of your open-sprint tickets have the chosen status, in the status category's color. Press to open that search in Jira. Follows the project dial unless its settings pin a project |
| Project Dial | dial | Turn to preview "All" and each project with To Do tickets; press or tap to choose. After 5 seconds without a press it shows the chosen one again |
| Ticket Dial | dial | Turn to browse the chosen project's To Do tickets. Press once to arm ("press again to send"), again within 3 seconds to send. Turning cancels. Tap the strip to open the ticket in Jira |

Only To Do tickets (Jira's "To Do" status category) appear on the dials, so a ticket already
in progress can't be sent twice. "Your tickets" means
`assignee = currentUser() AND sprint in openSprints()`, in board rank order.

## What a send does

1. Refuses if herdr already has an agent named after the ticket (`gg-8` for GG-8).
2. Opens a tab labelled with the key in herdr's focused workspace, in the dial's
   **Folder** (default: your home folder), and focuses it.
3. Starts the chosen **Agent** (default Claude) and waits until herdr says it's ready.
4. Sends the **Prompt**, default `/work-ticket {key}`. `{key}`, `{summary}` and `{url}` are
   filled in.
5. Brings the **Terminal app** forward (shared setting; turn off **Bring forward** to leave
   windows alone).

If a step fails, the strip says why and the tab stays open for you to look at; the
prompt is never retried.

## Develop

```sh
pnpm install
pnpm check                 # typecheck + tests
pnpm build
streamdeck link com.boxofraccoons.jira-herdr.sdPlugin   # then restart the Stream Deck app once
streamdeck restart com.boxofraccoons.jira-herdr        # after later builds
node scripts/make-images.ts                            # regenerate icons
JIRA_SITE=... JIRA_EMAIL=... JIRA_API_TOKEN=... npx tsx scripts/preview.mts "In Progress"
```

`preview.mts` prints what each action would show, from real Jira, read-only.
`herdr api schema --json` is the reference for herdr's socket API.

## Release

Bump `version` in `package.json` and the manifest's `Version`, merge to `main`, then tag
and push `vX.Y.Z`. The Release workflow checks the tag against `package.json`, runs the
checks, packs the plugin and publishes it as a GitHub release.

## License

MIT
