import { describe, expect, it } from "vitest";

import { JiraError, type Issue, type JiraCreds } from "../src/jira/client.js";
import { MAX_BACKOFF_MS, POLL_MS, STALE_MS, TicketService, type ServiceDeps } from "../src/service.js";
import { ALL, SCOPE_JQL } from "../src/tickets.js";
import { issue } from "./fixture.js";

const creds: JiraCreds = { site: "x.atlassian.net", email: "me@x", token: "t" };

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** A service with a hand-cranked clock and timers, and searches answered from a queue. */
function harness(over: Partial<ServiceDeps> = {}) {
	let now = 1_000_000;
	const timers: { fn: () => void; ms: number }[] = [];
	const searches: string[] = [];
	const answers: (Issue[] | Error | ReturnType<typeof deferred<Issue[]>>)[] = [];
	let currentCreds: JiraCreds | null = creds;
	const deps: ServiceDeps = {
		loadCreds: async () => currentCreds,
		search: async (_c, jql) => {
			searches.push(jql);
			const a = answers.shift() ?? [];
			if (a instanceof Error) throw a;
			if (Array.isArray(a)) return a;
			return a.promise;
		},
		setTimeout: (fn, ms) => {
			const t = { fn, ms };
			timers.push(t);
			return t;
		},
		clearTimeout: (h) => {
			const i = timers.indexOf(h as (typeof timers)[number]);
			if (i >= 0) timers.splice(i, 1);
		},
		now: () => now,
		log: () => {},
		...over,
	};
	const service = new TicketService(deps);
	let changes = 0;
	service.onChange(() => changes++);
	return {
		service,
		timers,
		searches,
		answers,
		get changes() {
			return changes;
		},
		advance: (ms: number) => {
			now += ms;
		},
		setCreds: (c: JiraCreds | null) => {
			currentCreds = c;
		},
	};
}

describe("TicketService", () => {
	it("fetches the scope query on start, then polls every minute", async () => {
		const h = harness();
		h.answers.push([issue("GG-1")]);
		h.service.start();
		await h.service.refresh();
		expect(h.searches).toEqual([SCOPE_JQL]);
		expect(h.service.issues?.map((i) => i.key)).toEqual(["GG-1"]);
		expect(h.service.site).toBe("x.atlassian.net");
		expect(h.service.problem).toBeNull();
		expect(h.timers.map((t) => t.ms)).toEqual([POLL_MS]);
		expect(h.changes).toBeGreaterThan(0);
	});

	it("starts once", async () => {
		const h = harness();
		h.service.start();
		h.service.start();
		await h.service.refresh();
		expect(h.searches).toHaveLength(1);
	});

	it("shares a fetch already under way", async () => {
		const h = harness();
		const d = deferred<Issue[]>();
		h.answers.push(d);
		const a = h.service.refresh();
		const b = h.service.refresh();
		d.resolve([]);
		await Promise.all([a, b]);
		expect(h.searches).toHaveLength(1);
	});

	it("asks for setup when there are no credentials, without calling Jira", async () => {
		const h = harness();
		h.setCreds(null);
		await h.service.refresh();
		expect(h.service.problem?.kind).toBe("setup");
		expect(h.service.issues).toBeNull();
		expect(h.searches).toHaveLength(0);
	});

	it("keeps the last list through an error, and says what went wrong", async () => {
		const h = harness();
		h.answers.push([issue("GG-1")], new JiraError("can't reach x"), new JiraError("rejected", 401), new JiraError("boom", 500));
		await h.service.refresh();
		await h.service.refresh();
		expect(h.service.problem?.kind).toBe("offline");
		expect(h.service.issues?.map((i) => i.key)).toEqual(["GG-1"]);
		await h.service.refresh();
		expect(h.service.problem?.kind).toBe("auth");
		await h.service.refresh();
		expect(h.service.problem?.kind).toBe("error");
	});

	it("backs off on repeated failures up to the cap, and recovers", async () => {
		const h = harness();
		h.service.start();
		const delays: number[] = [];
		for (let i = 0; i < 6; i++) {
			h.answers.push(new JiraError("down"));
			await h.service.refresh();
			delays.push(h.service.nextDelay());
		}
		expect(delays).toEqual([2 * POLL_MS, 4 * POLL_MS, 8 * POLL_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
		await h.service.refresh();
		expect(h.service.nextDelay()).toBe(POLL_MS);
		expect(h.timers.map((t) => t.ms)).toEqual([POLL_MS]); // one pending poll, not one per fetch
	});

	it("refreshes on a dial touch only when the list is stale", async () => {
		const h = harness();
		await h.service.refresh();
		h.advance(STALE_MS - 1);
		await h.service.refreshIfStale();
		expect(h.searches).toHaveLength(1);
		h.advance(1);
		await h.service.refreshIfStale();
		expect(h.searches).toHaveLength(2);
	});

	it("never shows tickets fetched with the old credentials", async () => {
		// The plugin starts fetching before global settings arrive. The answer to that
		// first fetch must not show, even briefly, while the new fetch is under way.
		const h = harness();
		const old = deferred<Issue[]>();
		const fresh = deferred<Issue[]>();
		h.answers.push(old, fresh);
		const first = h.service.refresh();
		await new Promise((r) => setTimeout(r, 0));
		expect(h.searches).toHaveLength(1); // the old search is waiting on Jira
		const second = h.service.credsChanged();
		old.resolve([issue("OLD-1")]);
		await first;
		await new Promise((r) => setTimeout(r, 0));
		expect(h.searches).toHaveLength(2);
		expect(h.service.issues).toBeNull();
		fresh.resolve([issue("NEW-1")]);
		await second;
		expect(h.service.issues?.map((i) => i.key)).toEqual(["NEW-1"]);
	});

	it("holds the chosen project and says when it changes", () => {
		const h = harness();
		expect(h.service.project).toBe(ALL);
		const before = h.changes;
		h.service.setProject("GG");
		h.service.setProject("GG");
		expect(h.service.project).toBe("GG");
		expect(h.changes).toBe(before + 1);
		h.service.setProject("");
		expect(h.service.project).toBe(ALL);
	});
});
