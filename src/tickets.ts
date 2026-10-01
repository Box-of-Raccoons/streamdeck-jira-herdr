/** Which tickets each action shows, and the Jira links it opens. Pure. */
import type { Issue } from "./jira/client.js";

/** Everything the plugin knows about: assigned to me, in an open sprint. */
export const SCOPE = "assignee = currentUser() AND sprint in openSprints()";
export const SCOPE_JQL = `${SCOPE} ORDER BY Rank ASC`;

/** The project dial's "All" entry. Project keys are uppercase letters and digits, so it can't clash. */
export const ALL = "*";

/** Only To Do (status category "new") can be sent; anything started already has an owner. */
export function sendable(issues: Issue[]): Issue[] {
	return issues.filter((i) => i.statusCategory === "new");
}

export interface ProjectItem {
	id: string;
	name: string;
	count: number;
}

/**
 * "All" first, then every project with To Do tickets, by key. `keep` (the chosen
 * project) stays listed with 0 when its last ticket goes, so the dial doesn't jump.
 */
export function projectItems(issues: Issue[], keep?: string): ProjectItem[] {
	const todo = sendable(issues);
	const counts = new Map<string, number>();
	for (const i of todo) counts.set(i.project, (counts.get(i.project) ?? 0) + 1);
	if (keep && keep !== ALL && !counts.has(keep)) counts.set(keep, 0);
	const projects = [...counts.keys()].sort((a, b) => a.localeCompare(b));
	return [{ id: ALL, name: "All", count: todo.length }, ...projects.map((p) => ({ id: p, name: p, count: counts.get(p)! }))];
}

/** The ticket dial's list: To Do tickets in the chosen project, in Jira's rank order. */
export function ticketsFor(issues: Issue[], project: string): Issue[] {
	return sendable(issues).filter((i) => project === ALL || i.project === project);
}

/** How many in-scope tickets have this status (any category), in the project. */
export function countStatus(issues: Issue[], status: string, project: string): number {
	const s = status.toLowerCase();
	return issues.filter((i) => i.status.toLowerCase() === s && (project === ALL || i.project === project)).length;
}

/** The status category of a status name, from whatever tickets carry it; null when none do. */
export function categoryOf(issues: Issue[], status: string): string | null {
	const s = status.toLowerCase();
	return issues.find((i) => i.status.toLowerCase() === s)?.statusCategory ?? null;
}

function quote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The search the status key opens: same scope, one status, maybe one project. */
export function statusJql(status: string, project: string): string {
	const projectClause = project === ALL ? "" : ` AND project = ${quote(project)}`;
	return `${SCOPE} AND status = ${quote(status)}${projectClause} ORDER BY Rank ASC`;
}

export function searchUrl(site: string, jql: string): string {
	return `https://${site}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function browseUrl(site: string, key: string): string {
	return `https://${site}/browse/${key}`;
}

export const DEFAULT_PROMPT = "/work-ticket {key}";

/** Fills {key}, {summary} and {url}; an empty template means the default. */
export function fillPrompt(template: string | undefined, issue: Issue, site: string): string {
	const t = template?.trim() || DEFAULT_PROMPT;
	return t.replace(/\{(key|summary|url)\}/g, (_, name: string) =>
		name === "key" ? issue.key : name === "summary" ? issue.summary : browseUrl(site, issue.key),
	);
}
