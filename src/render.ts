/** The status key's image (SVG, 144x144 on black) and the dials' strip text. Pure. */
import type { DialView } from "./dial.js";
import type { Issue } from "./jira/client.js";
import type { ProjectItem } from "./tickets.js";
import type { Problem } from "./service.js";

export const GREY = "#8E8E93";
const DIM = "#3A3A3C";
const WHITE = "#FFFFFF";
export const ACCENT = "#0A84FF";
export const ORANGE = "#FF9F0A";
export const GREEN = "#30D158";
export const RED = "#FF453A";
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;

/** Jira's status categories: new (To Do), indeterminate (In Progress), done. */
export const CATEGORY_COLORS: Record<string, string> = { new: "#C7C7CC", indeterminate: ACCENT, done: GREEN };

export function categoryColor(category: string | null): string {
	return (category && CATEGORY_COLORS[category]) || GREY;
}

function escapeXml(s: string): string {
	return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Shortens text to fit, with an ellipsis. */
export function fit(text: string, max: number): string {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** Two words a problem shows as, on a key or a strip. */
export const PROBLEM_WORDS: Record<Problem["kind"], string> = {
	setup: "set up Jira",
	auth: "token rejected",
	offline: "Jira offline",
	error: "Jira error",
};

function svg(body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#000000"/>${body}</svg>`;
}

function text(x: number, y: number, size: number, color: string, value: string, extra = ""): string {
	return `<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" fill="${color}"${extra}>${escapeXml(value)}</text>`;
}

export interface StatusKeyView {
	/** Null while no status is chosen. */
	status: string | null;
	/** "All" or a project key. */
	project: string;
	/** Null when there's no ticket list (problem or first load). */
	count: number | null;
	category: string | null;
	problem: Problem | null;
}

/**
 * Project on top, the count big in the status category's color, the status name
 * underneath. Zero is grey. A problem with no list to show replaces the count with "!".
 */
export function statusKey(v: StatusKeyView): string {
	const top = text(72, 30, 20, GREY, fit(v.project, 10));
	if (!v.status) return svg(top + text(72, 86, 22, GREY, "pick a") + text(72, 112, 22, GREY, "status"));
	// Grey like herdr Control's captions: white this close to the edge reflects in the keycap.
	const caption = text(72, 130, 19, GREY, fit(v.status, 12));
	if (v.count == null) {
		const words = v.problem ? PROBLEM_WORDS[v.problem.kind] : "loading";
		const mark = v.problem ? text(72, 86, 52, v.problem.kind === "setup" ? GREY : ORANGE, "!", ` font-weight="bold"`) : "";
		return svg(top + mark + text(72, 108, 16, GREY, words) + caption);
	}
	const color = v.count > 0 ? categoryColor(v.category) : DIM;
	const shown = v.count > 999 ? "999+" : String(v.count);
	const size = shown.length > 3 ? 40 : shown.length > 2 ? 50 : 62;
	return svg(top + text(72, 82 + size * 0.18, size, color, shown, ` font-weight="bold"`) + caption);
}

export interface Feedback {
	[key: string]: { value: string; color: string } | string;
	heading: { value: string; color: string };
	position: string;
	name: { value: string; color: string };
	detail: { value: string; color: string };
}

function feedback(heading: string, headingColor: string, position: string, name: string, nameColor: string, detail: string, detailColor: string): Feedback {
	return {
		heading: { value: heading, color: headingColor },
		position,
		name: { value: name, color: nameColor },
		detail: { value: detail, color: detailColor },
	};
}

function problemFeedback(heading: string, problem: Problem | null): Feedback {
	if (!problem) return feedback(heading, GREY, "", "loading", GREY, "", GREY);
	return feedback(heading, GREY, "", PROBLEM_WORDS[problem.kind], problem.kind === "setup" ? GREY : ORANGE, problem.kind === "setup" ? "open settings" : problem.message, GREY);
}

/** The project dial: "PROJECT" while showing the chosen one, "PRESS TO SWITCH" while previewing another. */
export function projectFeedback(view: DialView<ProjectItem> | null, problem: Problem | null): Feedback {
	if (!view?.item) return problemFeedback("PROJECT", problem);
	const n = view.item.count;
	return feedback(
		view.current ? "PROJECT" : "PRESS TO SWITCH",
		view.current ? GREY : ACCENT,
		`${view.index + 1}/${view.count}`,
		view.item.name,
		WHITE,
		`${n} to do`,
		n > 0 ? GREY : DIM,
	);
}

/** A short-lived message on the ticket dial after a send. */
export interface Flash {
	heading: string;
	color: string;
	/** The ticket the message is about, which may have left the list already. */
	key: string;
	detail: string;
}

export interface TicketDialView {
	item: Issue | null;
	index: number;
	count: number;
	/** The chosen project's name for the empty state. */
	project: string;
	armed: boolean;
	flash: Flash | null;
	problem: Problem | null;
	/** True once a list has loaded, even an empty one. */
	loaded: boolean;
}

export function ticketFeedback(v: TicketDialView): Feedback {
	if (!v.loaded) return problemFeedback("TICKET", v.problem);
	if (v.flash) return feedback(v.flash.heading, v.flash.color, v.item ? `${v.index + 1}/${v.count}` : "0/0", v.flash.key, WHITE, v.flash.detail, GREY);
	if (!v.item) return feedback("TICKET", GREY, "0/0", "nothing to do", GREY, v.project === "All" ? "in open sprints" : `in ${v.project}`, GREY);
	const position = `${v.index + 1}/${v.count}`;
	if (v.armed) return feedback("PRESS AGAIN TO SEND", ORANGE, position, v.item.key, ORANGE, v.item.summary, WHITE);
	return feedback(v.item.status.toUpperCase(), categoryColor(v.item.statusCategory), position, v.item.key, WHITE, v.item.summary, GREY);
}
