import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { execFile } from "node:child_process";

import type { Call } from "../herdr/client.js";
import { normalizeSite, statusNames, whoAmI, type JiraCreds } from "../jira/client.js";
import { readToken, saveToken } from "../jira/keychain.js";
import type { TicketService } from "../service.js";

/** Plugin-wide settings, shared by every action's settings panel. */
export type Globals = { site?: string; email?: string; terminalApp?: string; raise?: boolean };

/** What every action shares. */
export interface Ctx {
	service: TicketService;
	/** For quick herdr calls. */
	call: Call;
	/** For herdr calls that wait on an agent (start, prompt). */
	slowCall: Call;
	home: string;
	globals(): Globals;
	/** Brings the terminal app forward, unless the user turned that off. */
	raise(): Promise<void>;
	creds(): Promise<JiraCreds | null>;
	/** Forget the cached token, after a save or a site/email change. */
	forgetToken(): void;
}

export function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function openUrl(url: string): Promise<boolean> {
	return new Promise((resolve) => execFile("/usr/bin/open", [url], (err) => resolve(!err)));
}

/** Site and email from global settings, the token from the Keychain (cached until forgotten). */
export function credsLoader(globals: () => Globals): { creds: () => Promise<JiraCreds | null>; forget: () => void } {
	let cache: { id: string; token: string | null } | null = null;
	return {
		forget: () => {
			cache = null;
		},
		creds: async () => {
			const site = normalizeSite(globals().site ?? "");
			const email = globals().email?.trim() ?? "";
			if (!site || !email) return null;
			const id = `${email} on ${site}`;
			if (cache?.id !== id) cache = { id, token: await readToken(site, email) };
			return cache.token ? { site, email, token: cache.token } : null;
		},
	};
}

type PiRequest = { event?: string; token?: string };

/**
 * Requests from the settings panels, the same for every action: the token
 * box, the connection line, and the dropdowns filled from Jira (sdpi-components'
 * `datasource`, which expects `{event, items}` back).
 */
export async function handlePi(ctx: Ctx, raw: JsonValue): Promise<void> {
	const req = (raw ?? {}) as PiRequest;
	const reply = (payload: JsonValue) => streamDeck.ui.sendToPropertyInspector(payload);
	const status = (text: string, ok: boolean) => reply({ event: "tokenStatus", text, ok });

	switch (req.event) {
		case "saveToken": {
			const site = normalizeSite(ctx.globals().site ?? "");
			const email = ctx.globals().email?.trim() ?? "";
			if (!site || !email) return status("Fill in the site and email first.", false);
			try {
				await saveToken(site, email, req.token ?? "");
			} catch (e) {
				return status(message(e), false);
			}
			ctx.forgetToken();
			await connectionStatus(ctx, status);
			void ctx.service.credsChanged();
			return;
		}
		case "tokenStatus":
			return connectionStatus(ctx, status);
		case "getStatuses": {
			const creds = await ctx.creds();
			let items: { label: string; value: string }[];
			try {
				items = creds ? (await statusNames(creds)).map((n) => ({ label: n, value: n })) : [];
			} catch (e) {
				streamDeck.logger.warn(`statuses: ${message(e)}`);
				items = [];
			}
			if (!items.length) items = [{ label: "(connect to Jira first)", value: "" }];
			return reply({ event: "getStatuses", items });
		}
		case "getProjects": {
			const projects = [...new Set((ctx.service.issues ?? []).map((i) => i.project))].sort();
			return reply({
				event: "getProjects",
				items: [{ label: "Follow the project dial", value: "" }, { label: "All projects", value: "*" }, ...projects.map((p) => ({ label: p, value: p }))],
			});
		}
	}
}

async function connectionStatus(ctx: Ctx, status: (text: string, ok: boolean) => Promise<void>): Promise<void> {
	const g = ctx.globals();
	if (!g.site?.trim() || !g.email?.trim()) return status("Fill in the site and email, then save a token.", false);
	const creds = await ctx.creds();
	if (!creds) return status("No token saved for this site and email.", false);
	try {
		return status(`Connected as ${await whoAmI(creds)}. Token is in your Keychain.`, true);
	} catch (e) {
		return status(message(e), false);
	}
}
