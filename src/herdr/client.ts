/**
 * herdr's socket API: newline-delimited JSON over a Unix socket.
 * Requests use a fresh connection each (local, about 1 ms to connect); the event
 * subscription keeps one connection open.
 */
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

export class HerdrError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

/** Where herdr listens: HERDR_SOCKET_PATH when set, else the default session's socket. */
export function socketPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
	return env.HERDR_SOCKET_PATH || path.join(home, ".config", "herdr", "herdr.sock");
}

export type Call = <T = any>(method: string, params?: object) => Promise<T>;

/** Splits a byte stream into complete lines, keeping the partial tail. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
	let buf = "";
	return (chunk) => {
		buf += chunk.toString();
		let i: number;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (line) onLine(line);
		}
	};
}

let nextId = 0;

/** One request, one connection. Throws HerdrError with herdr's code, or `unreachable` / `timeout`. */
export function createCall(sock: string, timeoutMs = 10_000): Call {
	return (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = `sd_${++nextId}`;
			const conn = createConnection(sock);
			const timer = setTimeout(() => {
				conn.destroy();
				reject(new HerdrError("timeout", `herdr ${method} timed out`));
			}, timeoutMs);
			const done = (fn: () => void) => {
				clearTimeout(timer);
				conn.destroy();
				fn();
			};
			conn.on("connect", () => conn.write(JSON.stringify({ id, method, params }) + "\n"));
			conn.on("error", (e) => done(() => reject(new HerdrError("unreachable", e.message))));
			conn.on(
				"data",
				lineReader((line) => {
					let msg: { id?: string; result?: unknown; error?: { code?: string; message?: string } };
					try {
						msg = JSON.parse(line);
					} catch {
						return done(() => reject(new HerdrError("bad_response", line.slice(0, 200))));
					}
					if (msg.id !== id) return;
					if (msg.error) return done(() => reject(new HerdrError(msg.error!.code ?? "error", msg.error!.message ?? "herdr error")));
					done(() => resolve(msg.result as any));
				}),
			);
		});
}

export interface Subscription {
	close(): void;
}

/**
 * Opens `events.subscribe` and calls `onEvent` for every pushed line after the
 * acknowledgement. `onClose` fires once when the connection ends for any reason,
 * including a rejected subscription.
 */
export function subscribe(
	sock: string,
	subscriptions: object[],
	onEvent: (event: unknown) => void,
	onClose: (reason: string) => void,
): Subscription {
	const conn: Socket = createConnection(sock);
	let closed = false;
	const finish = (reason: string) => {
		if (closed) return;
		closed = true;
		conn.destroy();
		onClose(reason);
	};
	conn.on("connect", () => conn.write(JSON.stringify({ id: "sd_sub", method: "events.subscribe", params: { subscriptions } }) + "\n"));
	conn.on("error", (e) => finish(e.message));
	conn.on("close", () => finish("closed"));
	conn.on(
		"data",
		lineReader((line) => {
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg?.id === "sd_sub" && msg.error) return finish(`${msg.error.code}: ${msg.error.message}`);
			if (msg?.id === "sd_sub") return; // subscription_started
			onEvent(msg);
		}),
	);
	return { close: () => finish("closed by plugin") };
}
