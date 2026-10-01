/**
 * Jira Cloud REST v3 with an API token (basic auth). Adapted from deckhand's
 * client. Takes `fetch` so tests can stub it.
 */

export interface JiraCreds {
	/** Bare host, e.g. example.atlassian.net. */
	site: string;
	email: string;
	token: string;
}

export interface Issue {
	key: string;
	summary: string;
	/** Status name as shown on the board, e.g. "In Progress". */
	status: string;
	/** Jira's status category key: new, indeterminate, or done. */
	statusCategory: string;
	/** Project key, e.g. "GG". */
	project: string;
}

export class JiraError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

export interface FetchOptions {
	fetch?: typeof globalThis.fetch;
}

export interface SearchOptions extends FetchOptions {
	pageSize?: number;
	/** Stop after this many issues, however many pages Jira offers. */
	maxIssues?: number;
}

/** "https://x.atlassian.net/" or "x.atlassian.net" to "x.atlassian.net". */
export function normalizeSite(site: string): string {
	return site
		.trim()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
}

async function getJson<T>(creds: JiraCreds, pathAndQuery: string, fetch: typeof globalThis.fetch): Promise<T> {
	const auth = Buffer.from(`${creds.email}:${creds.token}`).toString("base64");
	let res: Response;
	try {
		res = await fetch(`https://${creds.site}${pathAndQuery}`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
	} catch (err) {
		throw new JiraError(`can't reach ${creds.site}: ${(err as Error).message}`);
	}
	if (!res.ok) throw new JiraError(describeFailure(res.status, await res.text(), creds.site), res.status);
	return (await res.json()) as T;
}

/**
 * GET /rest/api/3/search/jql, following nextPageToken. That endpoint returns
 * only ids unless `fields` is passed, and has no `total`.
 */
export async function searchIssues(
	creds: JiraCreds,
	jql: string,
	{ fetch = globalThis.fetch, pageSize = 100, maxIssues = 300 }: SearchOptions = {},
): Promise<Issue[]> {
	const issues: Issue[] = [];
	const seenTokens = new Set<string>();
	let token: string | undefined;

	do {
		const params = new URLSearchParams({ jql, fields: "summary,status,project", maxResults: String(pageSize) });
		if (token) params.set("nextPageToken", token);
		const body = await getJson<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(creds, `/rest/api/3/search/jql?${params}`, fetch);
		for (const raw of body.issues ?? []) issues.push(toIssue(raw));

		token = body.isLast ? undefined : body.nextPageToken;
		if (token && seenTokens.has(token)) token = undefined; // a repeated token would loop forever
		if (token) seenTokens.add(token);
	} while (token && issues.length < maxIssues);

	return issues.slice(0, maxIssues);
}

/** Every status name on the site, deduped and sorted, for the status key's dropdown. */
export async function statusNames(creds: JiraCreds, { fetch = globalThis.fetch }: FetchOptions = {}): Promise<string[]> {
	const statuses = await getJson<{ name?: string }[]>(creds, "/rest/api/3/status", fetch);
	const names = new Set(statuses.map((s) => s.name?.trim()).filter((n): n is string => !!n));
	return [...names].sort((a, b) => a.localeCompare(b));
}

/** Who the token belongs to; used by the settings panel's connection check. */
export async function whoAmI(creds: JiraCreds, { fetch = globalThis.fetch }: FetchOptions = {}): Promise<string> {
	const me = await getJson<{ displayName?: string; emailAddress?: string }>(creds, "/rest/api/3/myself", fetch);
	return me.displayName || me.emailAddress || creds.email;
}

interface RawIssue {
	key: string;
	fields?: {
		summary?: string;
		status?: { name?: string; statusCategory?: { key?: string } };
		project?: { key?: string };
	};
}

function toIssue(raw: RawIssue): Issue {
	const fields = raw.fields ?? {};
	return {
		key: raw.key,
		summary: fields.summary ?? "",
		status: fields.status?.name ?? "?",
		statusCategory: fields.status?.statusCategory?.key ?? "undefined",
		project: fields.project?.key ?? raw.key.replace(/-\d+$/, ""),
	};
}

function describeFailure(status: number, body: string, site: string): string {
	if (status === 401 || status === 403) return `Jira rejected the token (${status}) at ${site}. Check the email and API token; tokens expire within a year.`;
	if (status === 429) return "Jira is rate limiting (429).";
	let detail = body.slice(0, 300);
	try {
		const parsed = JSON.parse(body) as { errorMessages?: string[] };
		if (parsed.errorMessages?.length) detail = parsed.errorMessages.join("; ");
	} catch {
		// not JSON; keep the raw snippet
	}
	return `Jira request failed (${status}): ${detail}`;
}
