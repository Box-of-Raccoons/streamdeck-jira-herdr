import { describe, expect, it } from "vitest";

import { JiraError, normalizeSite, searchIssues, statusNames, whoAmI } from "../src/jira/client.js";

const creds = { site: "example.atlassian.net", email: "me@example.com", token: "tok" };

function issue(key: string, status = "To Do", category = "new", project: string | null = key.split("-")[0]) {
	return { key, fields: { summary: `summary ${key}`, status: { name: status, statusCategory: { key: category } }, ...(project ? { project: { key: project } } : {}) } };
}

/** A fetch stub that serves the given bodies in order and records each URL and headers. */
function stubFetch(bodies: unknown[]) {
	const urls: URL[] = [];
	const headers: Record<string, string>[] = [];
	const fetch = (async (input: string | URL, init?: RequestInit) => {
		urls.push(new URL(String(input)));
		headers.push(init?.headers as Record<string, string>);
		const body = bodies[urls.length - 1];
		if (body === undefined) throw new Error(`unexpected request ${urls.length}`);
		return new Response(JSON.stringify(body), { status: 200 });
	}) as typeof globalThis.fetch;
	return { fetch, urls, headers };
}

describe("searchIssues", () => {
	it("asks for the fields it needs, with basic auth, on /search/jql", async () => {
		const stub = stubFetch([{ issues: [issue("WF-1")], isLast: true }]);
		await searchIssues(creds, "project = WF", { fetch: stub.fetch });
		const url = stub.urls[0]!;
		expect(url.origin + url.pathname).toBe("https://example.atlassian.net/rest/api/3/search/jql");
		expect(url.searchParams.get("jql")).toBe("project = WF");
		expect(url.searchParams.get("fields")).toBe("summary,status,project");
		expect(stub.headers[0]!.Authorization).toBe(`Basic ${Buffer.from("me@example.com:tok").toString("base64")}`);
	});

	it("maps issues to key, summary, status, category and project", async () => {
		const stub = stubFetch([{ issues: [issue("WF-1", "In Progress", "indeterminate")], isLast: true }]);
		expect(await searchIssues(creds, "x", { fetch: stub.fetch })).toEqual([
			{ key: "WF-1", summary: "summary WF-1", status: "In Progress", statusCategory: "indeterminate", project: "WF" },
		]);
	});

	it("takes the project from the key when the field is missing", async () => {
		const stub = stubFetch([{ issues: [issue("ABC2-17", "To Do", "new", null)], isLast: true }]);
		expect((await searchIssues(creds, "x", { fetch: stub.fetch }))[0]!.project).toBe("ABC2");
	});

	it("follows nextPageToken until isLast", async () => {
		const stub = stubFetch([
			{ issues: [issue("WF-1"), issue("WF-2")], nextPageToken: "p2", isLast: false },
			{ issues: [issue("WF-3")], nextPageToken: "p3", isLast: false },
			{ issues: [issue("WF-4")], isLast: true },
		]);
		const issues = await searchIssues(creds, "x", { fetch: stub.fetch, pageSize: 2 });
		expect(issues.map((i) => i.key)).toEqual(["WF-1", "WF-2", "WF-3", "WF-4"]);
		expect(stub.urls.map((u) => u.searchParams.get("nextPageToken"))).toEqual([null, "p2", "p3"]);
	});

	it("stops at maxIssues", async () => {
		const stub = stubFetch([
			{ issues: [issue("WF-1"), issue("WF-2")], nextPageToken: "p2" },
			{ issues: [issue("WF-3"), issue("WF-4")], nextPageToken: "p3" },
		]);
		const issues = await searchIssues(creds, "x", { fetch: stub.fetch, maxIssues: 3 });
		expect(issues.map((i) => i.key)).toEqual(["WF-1", "WF-2", "WF-3"]);
		expect(stub.urls).toHaveLength(2);
	});

	it("does not loop forever on a repeated page token", async () => {
		const stub = stubFetch([
			{ issues: [issue("WF-1")], nextPageToken: "same" },
			{ issues: [issue("WF-2")], nextPageToken: "same" },
		]);
		expect(await searchIssues(creds, "x", { fetch: stub.fetch })).toHaveLength(2);
	});

	it("turns 401 into a token message with the status", async () => {
		const fetch = (async () => new Response("nope", { status: 401 })) as typeof globalThis.fetch;
		const err = await searchIssues(creds, "x", { fetch }).catch((e) => e);
		expect(err).toBeInstanceOf(JiraError);
		expect(err.status).toBe(401);
		expect(err.message).toMatch(/rejected the token/);
	});

	it("surfaces Jira errorMessages on a 400 (bad JQL)", async () => {
		const body = JSON.stringify({ errorMessages: ["Field 'bogus' does not exist"] });
		const fetch = (async () => new Response(body, { status: 400 })) as typeof globalThis.fetch;
		const err = await searchIssues(creds, "bogus = 1", { fetch }).catch((e) => e);
		expect(err.message).toBe("Jira request failed (400): Field 'bogus' does not exist");
	});

	it("wraps a network failure with no status", async () => {
		const fetch = (async () => {
			throw new TypeError("fetch failed");
		}) as typeof globalThis.fetch;
		const err = await searchIssues(creds, "x", { fetch }).catch((e) => e);
		expect(err).toBeInstanceOf(JiraError);
		expect(err.status).toBeUndefined();
		expect(err.message).toMatch(/can't reach example.atlassian.net/);
	});
});

describe("statusNames", () => {
	it("dedupes by name and sorts", async () => {
		const stub = stubFetch([[{ name: "To Do" }, { name: "Done" }, { name: "To Do" }, { name: " In Review " }, {}]]);
		expect(await statusNames(creds, { fetch: stub.fetch })).toEqual(["Done", "In Review", "To Do"]);
		expect(stub.urls[0]!.pathname).toBe("/rest/api/3/status");
	});
});

describe("whoAmI", () => {
	it("prefers the display name", async () => {
		expect(await whoAmI(creds, { fetch: stubFetch([{ displayName: "Hardy", emailAddress: "h@x" }]).fetch })).toBe("Hardy");
		expect(await whoAmI(creds, { fetch: stubFetch([{}]).fetch })).toBe("me@example.com");
	});
});

describe("normalizeSite", () => {
	it("keeps only the host", () => {
		expect(normalizeSite(" https://example.atlassian.net/jira/your-work ")).toBe("example.atlassian.net");
		expect(normalizeSite("example.atlassian.net")).toBe("example.atlassian.net");
	});
});
