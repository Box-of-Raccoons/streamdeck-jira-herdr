import type { Issue } from "../src/jira/client.js";

export function issue(key: string, status = "To Do", statusCategory = "new"): Issue {
	return { key, summary: `summary ${key}`, status, statusCategory, project: key.split("-")[0]! };
}
