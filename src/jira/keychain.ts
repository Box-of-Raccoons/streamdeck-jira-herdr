/**
 * The API token lives in the macOS login Keychain, not in Stream Deck's settings
 * (which aren't documented as encrypted). Uses /usr/bin/security; the token goes
 * in on stdin (`security -i`) so it never shows in a process listing.
 */
import { execFile } from "node:child_process";

export const SERVICE = "com.boxofraccoons.jira-herdr";
const SECURITY = "/usr/bin/security";

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}
export type Exec = (file: string, args: string[], input?: string) => Promise<ExecResult>;

export const exec: Exec = (file, args, input) =>
	new Promise((resolve) => {
		const child = execFile(file, args, { timeout: 10_000 }, (err, stdout, stderr) => {
			const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
			resolve({ code, stdout: String(stdout), stderr: String(stderr) });
		});
		if (input !== undefined) child.stdin?.end(input);
	});

/** One token per site and email, so switching sites doesn't reuse the wrong one. */
export function account(site: string, email: string): string {
	return `${email.trim()} on ${site}`;
}

/** `security -i` parses quoted words; refuse anything that could break out of the quotes. */
function safe(value: string, what: string): string {
	if (!/^[\x20-\x7e]+$/.test(value) || /["\\]/.test(value)) throw new Error(`${what} has characters the Keychain helper can't take`);
	return value;
}

/** The saved token, or null when there isn't one. */
export async function readToken(site: string, email: string, run: Exec = exec): Promise<string | null> {
	const r = await run(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", account(site, email), "-w"]);
	if (r.code !== 0) return null; // 44 = not found
	const token = r.stdout.replace(/\r?\n$/, "");
	return token || null;
}

/** Adds or replaces the token. Throws with security's message on failure. */
export async function saveToken(site: string, email: string, token: string, run: Exec = exec): Promise<void> {
	const t = safe(token.trim(), "The token");
	if (!t) throw new Error("The token is empty");
	const acct = safe(account(site, email), "The site or email");
	const r = await run(SECURITY, ["-i"], `add-generic-password -U -s "${SERVICE}" -a "${acct}" -l "herdr Tickets for Jira" -w "${t}"\n`);
	// `security -i` exits with the failed command's status (checked on macOS 27).
	if (r.code !== 0) throw new Error(`Keychain refused the token: ${r.stderr.trim() || `exit ${r.code}`}`);
}
