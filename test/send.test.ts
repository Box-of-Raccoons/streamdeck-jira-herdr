import { describe, expect, it } from "vitest";

import type { Call } from "../src/herdr/client.js";
import { agentNameFor, expandHome, sendTicket, SendError, type SendOptions } from "../src/send.js";

type AgentState = { launch_pending?: boolean; interactive_ready?: boolean; agent_status?: string };
const READY: AgentState = { interactive_ready: true, agent_status: "idle" };

/** A clock that only moves when the code sleeps. */
function fakeClock() {
	let t = 0;
	return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

/**
 * A fake herdr: records every request and answers from a table. `states` is what
 * successive agent.get calls report (the last one repeats). agent.prompt fails
 * with agent_not_ready, as the real one does, until agent.get has reported ready.
 */
function fakeHerdr(agents: { name?: string | null }[] = [], fail?: string, states: AgentState[] = [READY]) {
	let gets = 0;
	let ready = false;
	const calls: { method: string; params: unknown; slow: boolean }[] = [];
	const make =
		(slow: boolean): Call =>
		async (method, params = {}) => {
			calls.push({ method, params, slow });
			if (method === fail) throw new Error(`${method} failed`);
			if (method === "session.snapshot") return { snapshot: { focused_workspace_id: "w2", agents } } as any;
			if (method === "tab.create") return { tab: { tab_id: "t9" }, root_pane: { pane_id: "p9" } } as any;
			if (method === "agent.get") {
				const agent = states[Math.min(gets++, states.length - 1)]!;
				ready = !!agent.interactive_ready && !agent.launch_pending;
				return { agent } as any;
			}
			if (method === "agent.prompt" && !ready) throw new Error("agent_not_ready");
			return {} as any;
		};
	return { call: make(false), slowCall: make(true), calls };
}

const base: SendOptions = { key: "GG-8", prompt: "/work-ticket GG-8", folder: "~/code", kind: "", focus: true, home: "/Users/me", clock: fakeClock() };

describe("sendTicket", () => {
	it("opens a tab in the focused workspace, starts claude, then prompts it", async () => {
		const h = fakeHerdr([{ name: "gg-80" }, { name: null }]);
		expect(await sendTicket(h.call, h.slowCall, base)).toBe("gg-8");
		expect(h.calls).toEqual([
			{ method: "session.snapshot", params: {}, slow: false },
			{ method: "tab.create", params: { workspace_id: "w2", cwd: "/Users/me/code", label: "GG-8", focus: true }, slow: false },
			{ method: "agent.start", params: { name: "gg-8", kind: "claude", pane_id: "p9", timeout_ms: 90_000 }, slow: true },
			{ method: "agent.get", params: { target: "gg-8" }, slow: false },
			{ method: "agent.prompt", params: { target: "gg-8", text: "/work-ticket GG-8" }, slow: true },
		]);
	});

	it("uses the chosen agent kind, home for an empty folder, and passes focus through", async () => {
		const h = fakeHerdr();
		await sendTicket(h.call, h.slowCall, { ...base, folder: " ", kind: "codex", focus: false });
		expect(h.calls[1]!.params).toMatchObject({ cwd: "/Users/me", focus: false });
		expect(h.calls[2]!.params).toMatchObject({ kind: "codex" });
	});

	it("refuses a ticket that already has an agent, before touching herdr", async () => {
		const h = fakeHerdr([{ name: "gg-8" }]);
		const err = await sendTicket(h.call, h.slowCall, base).catch((e) => e);
		expect(err).toBeInstanceOf(SendError);
		expect(err.message).toBe("GG-8 already has an agent");
		expect(h.calls.map((c) => c.method)).toEqual(["session.snapshot"]);
	});

	it("waits for a pending launch before prompting", async () => {
		// Real herdr 0.9.2: agent.start returns with launch_pending, and an early prompt fails.
		const pending = { launch_pending: true, agent_status: "unknown" };
		const h = fakeHerdr([], undefined, [pending, { interactive_ready: false, agent_status: "unknown" }, { ...pending, interactive_ready: true }, READY]);
		await sendTicket(h.call, h.slowCall, base);
		expect(h.calls.map((c) => c.method)).toEqual(["session.snapshot", "tab.create", "agent.start", "agent.get", "agent.get", "agent.get", "agent.get", "agent.prompt"]);
	});

	it("gives up when the agent never gets ready, without prompting", async () => {
		const h = fakeHerdr([], undefined, [{ launch_pending: true }]);
		await expect(sendTicket(h.call, h.slowCall, { ...base, clock: fakeClock() })).rejects.toThrow("the agent wasn't ready after 90 s");
		expect(h.calls.map((c) => c.method)).not.toContain("agent.prompt");
	});

	it("won't type into an agent that's stuck on a dialog", async () => {
		const h = fakeHerdr([], undefined, [{ interactive_ready: true, agent_status: "blocked" }]);
		await expect(sendTicket(h.call, h.slowCall, base)).rejects.toThrow(/waiting on a prompt/);
		expect(h.calls.map((c) => c.method)).not.toContain("agent.prompt");
	});

	it("stops at a failed step and never prompts after a failed start", async () => {
		const h = fakeHerdr([], "agent.start");
		await expect(sendTicket(h.call, h.slowCall, base)).rejects.toThrow("agent.start failed");
		expect(h.calls.map((c) => c.method)).toEqual(["session.snapshot", "tab.create", "agent.start"]);
	});
});

describe("agentNameFor", () => {
	it("lowercases a key into a valid agent name", () => {
		expect(agentNameFor("GG-8")).toBe("gg-8");
		expect(agentNameFor("ABC_2-17")).toBe("abc_2-17");
		expect(agentNameFor("9X-1")).toBe("x-1");
		expect(agentNameFor("A".repeat(40) + "-1")).toHaveLength(32);
		for (const k of ["GG-8", "9X-1", "A".repeat(40) + "-1"]) expect(agentNameFor(k)).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
	});
});

describe("expandHome", () => {
	it("expands ~ and ~/ only", () => {
		expect(expandHome("~", "/h")).toBe("/h");
		expect(expandHome("~/code", "/h")).toBe("/h/code");
		expect(expandHome("/abs/~", "/h")).toBe("/abs/~");
	});
});
