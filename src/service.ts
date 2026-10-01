/**
 * The one ticket list every action reads, so swiping pages never shows an empty
 * list. Polls Jira while running, backs off on errors, and also holds the project
 * chosen on the project dial (the ticket dial and status key follow it).
 */
import { JiraError, type Issue, type JiraCreds } from "./jira/client.js";
import { ALL, SCOPE_JQL } from "./tickets.js";

export const POLL_MS = 60_000;
export const MAX_BACKOFF_MS = 10 * 60_000;
export const STALE_MS = 10_000;

export type ProblemKind = "setup" | "auth" | "offline" | "error";
export interface Problem {
	kind: ProblemKind;
	message: string;
}

export interface ServiceDeps {
	/** Null when the site, email or token isn't set up yet. */
	loadCreds(): Promise<JiraCreds | null>;
	search(creds: JiraCreds, jql: string): Promise<Issue[]>;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
	log(msg: string): void;
}

export function classify(e: unknown): Problem {
	const message = e instanceof Error ? e.message : String(e);
	if (e instanceof JiraError) {
		if (e.status === 401 || e.status === 403) return { kind: "auth", message };
		if (e.status === undefined) return { kind: "offline", message };
	}
	return { kind: "error", message };
}

export class TicketService {
	/** Null until the first successful fetch. Kept through later errors, so a blip doesn't blank the dials. */
	issues: Issue[] | null = null;
	problem: Problem | null = null;
	/** The site the issues came from, for links. */
	site = "";
	private _project = ALL;
	private fetchedAt = -Infinity;
	private inflight: Promise<void> | null = null;
	private timer: unknown = null;
	private started = false;
	private failures = 0;
	/** Bumped when credentials change, so a fetch started with the old ones is thrown away. */
	private generation = 0;
	private listeners: (() => void)[] = [];

	constructor(private deps: ServiceDeps) {}

	get project(): string {
		return this._project;
	}

	setProject(project: string): void {
		const p = project || ALL;
		if (p === this._project) return;
		this._project = p;
		this.emit();
	}

	onChange(fn: () => void): void {
		this.listeners.push(fn);
	}

	/** Starts polling; later calls do nothing. */
	start(): void {
		if (this.started) return;
		this.started = true;
		void this.refresh();
	}

	/** Fetches now, sharing a fetch already under way. Schedules the next poll. */
	refresh(): Promise<void> {
		this.inflight ??= this.fetch().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	/** Refresh only when the list is older than STALE_MS; for dial touches. */
	refreshIfStale(): Promise<void> {
		if (this.deps.now() - this.fetchedAt < STALE_MS) return Promise.resolve();
		return this.refresh();
	}

	/** Credentials changed: drop what came from the old ones and fetch again. */
	credsChanged(): Promise<void> {
		this.generation++;
		this.issues = null;
		this.problem = null;
		this.fetchedAt = -Infinity;
		this.emit();
		const again = () => this.refresh();
		return this.inflight ? this.inflight.then(again) : again();
	}

	/** The wait before the next poll: POLL_MS, doubling per consecutive failure up to MAX_BACKOFF_MS. */
	nextDelay(): number {
		return Math.min(POLL_MS * 2 ** this.failures, MAX_BACKOFF_MS);
	}

	private async fetch(): Promise<void> {
		const generation = this.generation;
		const stale = () => generation !== this.generation;
		try {
			const creds = await this.deps.loadCreds();
			if (stale()) return;
			if (!creds) {
				this.issues = null;
				this.problem = { kind: "setup", message: "Add your Jira site, email and API token in the action's settings." };
				this.failures = 0;
			} else {
				const issues = await this.deps.search(creds, SCOPE_JQL);
				if (stale()) return;
				this.issues = issues;
				this.site = creds.site;
				this.problem = null;
				this.failures = 0;
				this.fetchedAt = this.deps.now();
			}
		} catch (e) {
			if (stale()) return;
			this.problem = classify(e);
			this.failures++;
			this.deps.log(`jira: ${this.problem.message}`);
		}
		this.schedule();
		this.emit();
	}

	private schedule(): void {
		if (!this.started) return;
		if (this.timer != null) this.deps.clearTimeout(this.timer);
		this.timer = this.deps.setTimeout(() => {
			this.timer = null;
			void this.refresh();
		}, this.nextDelay());
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}
}
