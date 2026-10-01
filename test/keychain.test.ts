import { describe, expect, it } from "vitest";

import { account, readToken, saveToken, SERVICE, type Exec, type ExecResult } from "../src/jira/keychain.js";

function recorder(result: Partial<ExecResult> = {}) {
	const calls: { file: string; args: string[]; input?: string }[] = [];
	const run: Exec = async (file, args, input) => {
		calls.push({ file, args, input });
		return { code: 0, stdout: "", stderr: "", ...result };
	};
	return { run, calls };
}

describe("readToken", () => {
	it("asks security for the password of this site and email", async () => {
		const { run, calls } = recorder({ stdout: "tok-123=\n" });
		expect(await readToken("x.atlassian.net", "me@x.com", run)).toBe("tok-123=");
		expect(calls[0]).toEqual({
			file: "/usr/bin/security",
			args: ["find-generic-password", "-s", SERVICE, "-a", "me@x.com on x.atlassian.net", "-w"],
			input: undefined,
		});
	});

	it("is null when there's no item", async () => {
		const { run } = recorder({ code: 44, stderr: "could not be found" });
		expect(await readToken("x", "y", run)).toBeNull();
	});
});

describe("saveToken", () => {
	it("passes the token on stdin, never in the arguments", async () => {
		const { run, calls } = recorder();
		await saveToken("x.atlassian.net", "me@x.com", "  tok-123=  ", run);
		expect(calls[0]!.args).toEqual(["-i"]);
		expect(calls[0]!.args.join(" ")).not.toContain("tok-123");
		expect(calls[0]!.input).toBe(`add-generic-password -U -s "${SERVICE}" -a "${account("x.atlassian.net", "me@x.com")}" -l "herdr Tickets for Jira" -w "tok-123="\n`);
	});

	it("refuses quotes, backslashes and newlines that could escape the command", async () => {
		const { run, calls } = recorder();
		for (const bad of ['a"b', "a\\b", "a\nb"]) {
			await expect(saveToken("x", "y", bad, run)).rejects.toThrow(/characters/);
		}
		await expect(saveToken("x", 'y"', "ok", run)).rejects.toThrow(/site or email/);
		expect(calls).toHaveLength(0);
	});

	it("refuses an empty token", async () => {
		await expect(saveToken("x", "y", "   ", recorder().run)).rejects.toThrow();
	});

	it("reports security's failure", async () => {
		const { run } = recorder({ code: 2, stderr: "add-generic-password: returned 2" });
		await expect(saveToken("x", "y", "tok", run)).rejects.toThrow(/returned 2/);
	});
});
