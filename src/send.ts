/**
 * Sends a ticket to herdr: a new tab in the focused workspace, an agent started
 * in it, then the prompt. Three steps rather than a prompt passed to agent.start,
 * because agent.prompt refuses to type into a trust or permission dialog.
 */
import type { Call } from "./herdr/client.js";

export class SendError extends Error {}

/** Agent names must match [a-z][a-z0-9_-]{0,31}; Jira keys lowercased do ("gg-8"). */
export function agentNameFor(key: string): string {
	let name = key
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^[^a-z]+/, "");
	if (!name) name = "ticket";
	return name.slice(0, 32);
}

/** `~` and `~/x` to the home folder; other paths unchanged. */
export function expandHome(p: string, home: string): string {
	if (p === "~") return home;
	if (p.startsWith("~/")) return home + p.slice(1);
	return p;
}

export interface SendOptions {
	key: string;
	prompt: string;
	/** Folder the tab opens in; `~` allowed, empty means home. */
	folder?: string;
	/** Agent kind (claude, codex, ...); empty means claude. */
	kind?: string;
	/** Focus the new tab (herdr Control's New Tab does). */
	focus: boolean;
	home: string;
	/** For tests; real time by default. */
	clock?: Clock;
}

export interface Clock {
	now(): number;
	sleep(ms: number): Promise<void>;
}

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;

interface AgentInfo {
	agent: { launch_pending?: boolean; interactive_ready?: boolean; agent_status?: string };
}

/**
 * Over the socket, agent.start returns at once with `launch_pending: true` (the CLI
 * waits; the socket doesn't), and agent.prompt refuses until the agent is up
 * (`agent_not_ready`). So poll agent.get until herdr says it's ready for input.
 */
export async function waitUntilReady(call: Call, name: string, clock: Clock = realClock, timeoutMs = READY_TIMEOUT_MS): Promise<void> {
	const start = clock.now();
	for (;;) {
		const { agent } = await call<AgentInfo>("agent.get", { target: name });
		if (agent.interactive_ready && !agent.launch_pending) {
			if (agent.agent_status === "blocked") throw new SendError("the agent is waiting on a prompt in its tab");
			return;
		}
		if (clock.now() - start >= timeoutMs) throw new SendError(`the agent wasn't ready after ${Math.round(timeoutMs / 1000)} s`);
		await clock.sleep(READY_POLL_MS);
	}
}

interface SnapshotAgents {
	snapshot: { focused_workspace_id?: string | null; agents: { name?: string | null }[] };
}

/**
 * `call` is for quick requests; `slowCall` is for agent.start and agent.prompt,
 * which can take a while. Returns the agent's name. Throws SendError with a short reason.
 */
export async function sendTicket(call: Call, slowCall: Call, o: SendOptions): Promise<string> {
	const name = agentNameFor(o.key);
	const { snapshot } = await call<SnapshotAgents>("session.snapshot");
	if (snapshot.agents.some((a) => a.name === name)) throw new SendError(`${o.key} already has an agent`);

	const folder = o.folder?.trim();
	const cwd = folder ? expandHome(folder, o.home) : o.home;
	const created = await call<{ root_pane: { pane_id: string } }>("tab.create", {
		workspace_id: snapshot.focused_workspace_id ?? undefined,
		cwd,
		label: o.key,
		focus: o.focus,
	});
	const kind = o.kind?.trim() || "claude";
	await slowCall("agent.start", { name, kind, pane_id: created.root_pane.pane_id, timeout_ms: READY_TIMEOUT_MS });
	await waitUntilReady(call, name, o.clock);
	await slowCall("agent.prompt", { target: name, text: o.prompt });
	return name;
}
