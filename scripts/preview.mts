/**
 * Prints what the actions would show, from real Jira. Reads JIRA_SITE, JIRA_EMAIL
 * and JIRA_API_TOKEN from the environment (not the Keychain). Read-only.
 * Run: npx tsx scripts/preview.mts [status]
 */
import { normalizeSite, searchIssues } from "../src/jira/client.ts";
import { ALL, countStatus, projectItems, SCOPE_JQL, searchUrl, statusJql, ticketsFor } from "../src/tickets.ts";

const { JIRA_SITE = "", JIRA_EMAIL = "", JIRA_API_TOKEN = "" } = process.env;
if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error("set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN");
const creds = { site: normalizeSite(JIRA_SITE), email: JIRA_EMAIL, token: JIRA_API_TOKEN };
const status = process.argv[2] ?? "To Do";

const issues = await searchIssues(creds, SCOPE_JQL);
console.log(`${issues.length} tickets in open sprints`);
console.log(`\nStatus key "${status}": ${countStatus(issues, status, ALL)} (All)`);
console.log(`  press opens ${searchUrl(creds.site, statusJql(status, ALL))}`);
console.log("\nProject dial:");
for (const p of projectItems(issues)) {
	console.log(`  ${p.name.padEnd(6)} ${p.count} to do`);
	for (const t of ticketsFor(issues, p.id)) if (p.id !== ALL) console.log(`         ${t.key.padEnd(8)} ${t.status.padEnd(12)} ${t.summary.slice(0, 60)}`);
}
const skipped = issues.filter((i) => i.statusCategory !== "new");
console.log(`\nNot on the ticket dial (started or done): ${skipped.map((i) => `${i.key} ${i.status}`).join(", ") || "none"}`);
