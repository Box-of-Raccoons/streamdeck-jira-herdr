import { describe, expect, it } from "vitest";

import {
	ALL,
	categoryOf,
	countStatus,
	fillPrompt,
	projectItems,
	SCOPE_JQL,
	searchUrl,
	sendable,
	statusJql,
	ticketsFor,
} from "../src/tickets.js";
import { issue } from "./fixture.js";


const issues = [
	issue("WF-3"),
	issue("GG-8"),
	issue("GG-9", "In Progress", "indeterminate"),
	issue("WF-1", "Selected for Development"),
	issue("MP-1", "Done", "done"),
	issue("GG-2"),
];

describe("scope", () => {
	it("is my tickets in open sprints, in rank order", () => {
		expect(SCOPE_JQL).toBe("assignee = currentUser() AND sprint in openSprints() ORDER BY Rank ASC");
	});
});

describe("sendable", () => {
	it("keeps only To Do category tickets, whatever the status is called", () => {
		expect(sendable(issues).map((i) => i.key)).toEqual(["WF-3", "GG-8", "WF-1", "GG-2"]);
	});
});

describe("projectItems", () => {
	it("lists All first, then projects with To Do tickets by key, with counts", () => {
		expect(projectItems(issues)).toEqual([
			{ id: ALL, name: "All", count: 4 },
			{ id: "GG", name: "GG", count: 2 },
			{ id: "WF", name: "WF", count: 2 },
		]);
	});

	it("keeps the chosen project listed at 0 after its last ticket goes", () => {
		expect(projectItems(issues, "MP").map((p) => [p.id, p.count])).toEqual([
			[ALL, 4],
			["GG", 2],
			["MP", 0],
			["WF", 2],
		]);
		expect(projectItems(issues, ALL)).toHaveLength(3);
	});
});

describe("ticketsFor", () => {
	it("is To Do tickets in the project, in list order", () => {
		expect(ticketsFor(issues, "GG").map((i) => i.key)).toEqual(["GG-8", "GG-2"]);
		expect(ticketsFor(issues, ALL).map((i) => i.key)).toEqual(["WF-3", "GG-8", "WF-1", "GG-2"]);
		expect(ticketsFor(issues, "MP")).toEqual([]);
	});
});

describe("countStatus and categoryOf", () => {
	it("counts any status, case-insensitively, in the project", () => {
		expect(countStatus(issues, "to do", ALL)).toBe(3);
		expect(countStatus(issues, "To Do", "GG")).toBe(2);
		expect(countStatus(issues, "Done", ALL)).toBe(1);
		expect(countStatus(issues, "Done", "GG")).toBe(0);
	});

	it("finds the category from a ticket with that status", () => {
		expect(categoryOf(issues, "in progress")).toBe("indeterminate");
		expect(categoryOf(issues, "Blocked")).toBeNull();
	});
});

describe("statusJql and searchUrl", () => {
	it("adds the status, and the project unless All", () => {
		expect(statusJql("In Progress", ALL)).toBe('assignee = currentUser() AND sprint in openSprints() AND status = "In Progress" ORDER BY Rank ASC');
		expect(statusJql("To Do", "GG")).toBe('assignee = currentUser() AND sprint in openSprints() AND status = "To Do" AND project = "GG" ORDER BY Rank ASC');
	});

	it("escapes quotes and backslashes in a status name", () => {
		expect(statusJql('Say "hi" \\o/', ALL)).toContain('status = "Say \\"hi\\" \\\\o/"');
	});

	it("encodes the JQL into an issue search link", () => {
		const url = new URL(searchUrl("x.atlassian.net", statusJql("To Do", "GG")));
		expect(url.origin + url.pathname).toBe("https://x.atlassian.net/issues/");
		expect(url.searchParams.get("jql")).toBe(statusJql("To Do", "GG"));
	});
});

describe("fillPrompt", () => {
	const i = issue("GG-8");
	it("defaults to /work-ticket", () => {
		expect(fillPrompt(undefined, i, "x.atlassian.net")).toBe("/work-ticket GG-8");
		expect(fillPrompt("  ", i, "x.atlassian.net")).toBe("/work-ticket GG-8");
	});

	it("fills key, summary and url, every time they appear", () => {
		expect(fillPrompt("{key}: {summary} ({url}) {key} {other}", i, "x.atlassian.net")).toBe(
			"GG-8: summary GG-8 (https://x.atlassian.net/browse/GG-8) GG-8 {other}",
		);
	});
});
