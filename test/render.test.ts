import { describe, expect, it } from "vitest";

import { ACCENT, CATEGORY_COLORS, GREEN, GREY, ORANGE, projectFeedback, statusKey, ticketFeedback, type TicketDialView } from "../src/render.js";
import { ALL } from "../src/tickets.js";
import { issue } from "./fixture.js";

describe("statusKey", () => {
	const base = { status: "In Progress", project: "GG", count: 3, category: "indeterminate", problem: null };

	it("draws the count in the status category's color, with project and status", () => {
		const svg = statusKey(base);
		expect(svg).toContain(`fill="${CATEGORY_COLORS.indeterminate}" font-weight="bold">3</text>`);
		expect(svg).toContain(">GG</text>");
		expect(svg).toContain(">In Progress</text>");
	});

	it("dims a zero count", () => {
		expect(statusKey({ ...base, count: 0 })).not.toContain(`fill="${CATEGORY_COLORS.indeterminate}"`);
	});

	it("asks for a status before one is chosen", () => {
		expect(statusKey({ ...base, status: null })).toContain(">pick a</text>");
	});

	it("shows the problem when there's no list", () => {
		const svg = statusKey({ ...base, count: null, problem: { kind: "auth", message: "401" } });
		expect(svg).toContain(">token rejected</text>");
		expect(svg).toContain(`fill="${ORANGE}" font-weight="bold">!</text>`);
	});

	it("escapes status names", () => {
		expect(statusKey({ ...base, status: "A<B" })).toContain("A&#60;B");
	});
});

describe("projectFeedback", () => {
	const item = { id: "GG", name: "GG", count: 2 };
	it("shows the chosen project and its To Do count", () => {
		const f = projectFeedback({ item, index: 1, count: 3, current: true }, null);
		expect(f).toMatchObject({ heading: { value: "PROJECT", color: GREY }, position: "2/3", name: { value: "GG" }, detail: { value: "2 to do" } });
	});

	it("says press to switch while previewing another", () => {
		expect(projectFeedback({ item, index: 1, count: 3, current: false }, null).heading).toEqual({ value: "PRESS TO SWITCH", color: ACCENT });
	});

	it("shows setup when there's nothing loaded", () => {
		expect(projectFeedback(null, { kind: "setup", message: "" }).name.value).toBe("set up Jira");
	});
});

describe("ticketFeedback", () => {
	const view: TicketDialView = { item: issue("GG-8"), index: 0, count: 2, project: "GG", armed: false, flash: null, problem: null, loaded: true };

	it("shows status, key and summary", () => {
		expect(ticketFeedback(view)).toMatchObject({
			heading: { value: "TO DO", color: CATEGORY_COLORS.new },
			position: "1/2",
			name: { value: "GG-8" },
			detail: { value: "summary GG-8" },
		});
	});

	it("asks for the second press while armed", () => {
		expect(ticketFeedback({ ...view, armed: true }).heading).toEqual({ value: "PRESS AGAIN TO SEND", color: ORANGE });
	});

	it("shows a flash about its own ticket, even after the list moved on", () => {
		const f = ticketFeedback({ ...view, item: null, count: 0, flash: { heading: "SENT", color: GREEN, key: "GG-7", detail: "running as gg-7" } });
		expect(f).toMatchObject({ heading: { value: "SENT", color: GREEN }, name: { value: "GG-7" }, detail: { value: "running as gg-7" } });
	});

	it("says when there's nothing to do", () => {
		expect(ticketFeedback({ ...view, item: null, count: 0 }).name.value).toBe("nothing to do");
		expect(ticketFeedback({ ...view, item: null, count: 0, project: "All" }).detail.value).toBe("in open sprints");
		expect(ALL).toBe("*");
	});

	it("shows the problem before anything loads", () => {
		expect(ticketFeedback({ ...view, item: null, loaded: false, problem: { kind: "offline", message: "x" } }).name.value).toBe("Jira offline");
	});
});
