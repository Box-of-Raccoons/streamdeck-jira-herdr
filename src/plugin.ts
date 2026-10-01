import streamDeck from "@elgato/streamdeck";
import { homedir } from "node:os";

import { credsLoader, type Ctx, type Globals } from "./actions/context.js";
import { ProjectDial } from "./actions/project-dial.js";
import { StatusKey } from "./actions/status-key.js";
import { TicketDial } from "./actions/ticket-dial.js";
import { createCall, socketPath } from "./herdr/client.js";
import { searchIssues } from "./jira/client.js";
import { openApp } from "./launch.js";
import { TicketService } from "./service.js";

streamDeck.logger.setLevel("info");

let globals: Globals = {};
const loader = credsLoader(() => globals);
const sock = socketPath();

const ctx: Ctx = {
	service: new TicketService({
		loadCreds: loader.creds,
		search: (creds, jql) => searchIssues(creds, jql),
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
		now: () => Date.now(),
		log: (msg) => streamDeck.logger.info(msg),
	}),
	call: createCall(sock, 10_000),
	// agent.start waits up to 90 s for the agent to be ready.
	slowCall: createCall(sock, 100_000),
	home: homedir(),
	globals: () => globals,
	creds: loader.creds,
	forgetToken: loader.forget,
	raise: async () => {
		if (globals.raise === false) return;
		if (!(await openApp(globals.terminalApp))) streamDeck.logger.warn(`could not open "${globals.terminalApp ?? ""}"`);
	},
};

/** Site or email changed: the cached token and the ticket list belong to the old ones. */
function applyGlobals(next: Globals): void {
	const changed = (next.site ?? "") !== (globals.site ?? "") || (next.email ?? "") !== (globals.email ?? "");
	globals = next;
	if (changed) {
		loader.forget();
		void ctx.service.credsChanged();
	}
}

streamDeck.settings.onDidReceiveGlobalSettings<Globals>((ev) => applyGlobals(ev.settings));

for (const a of [StatusKey, ProjectDial, TicketDial]) {
	streamDeck.actions.registerAction(new a(ctx));
}

await streamDeck.connect();
applyGlobals(await streamDeck.settings.getGlobalSettings<Globals>());
