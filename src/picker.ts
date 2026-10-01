/** The ticket dial's cursor and its press-twice-to-send guard. Pure; time is passed in. */

export const ARM_MS = 3_000;

/**
 * Which ticket the dial shows. Remembers the key, so a refresh that reorders the
 * list keeps the same ticket; when that ticket goes, it stays at the same position.
 */
export class TicketCursor {
	private key: string | null = null;
	private index = 0;

	view<T>(items: T[], keyOf: (t: T) => string): { item: T | null; index: number; count: number } {
		if (items.length === 0) return { item: null, index: 0, count: 0 };
		let i = this.key == null ? -1 : items.findIndex((t) => keyOf(t) === this.key);
		if (i < 0) i = Math.min(this.index, items.length - 1);
		this.index = i;
		this.key = keyOf(items[i]);
		return { item: items[i], index: i, count: items.length };
	}

	/** Moves `ticks` tickets (negative is back), wrapping. */
	turn<T>(items: T[], keyOf: (t: T) => string, ticks: number): void {
		if (items.length === 0) return;
		const { index } = this.view(items, keyOf);
		const next = (((index + ticks) % items.length) + items.length) % items.length;
		this.index = next;
		this.key = keyOf(items[next]);
	}

	/** Back to the top of the list, for when the project changes. */
	reset(): void {
		this.key = null;
		this.index = 0;
	}
}

/**
 * First press arms the shown ticket; a second press on the same ticket within
 * ARM_MS sends it. Turning the dial cancels.
 */
export class ArmGuard {
	private key: string | null = null;
	private at = 0;

	press(key: string, now: number): "armed" | "send" {
		if (this.armed(now) === key) {
			this.key = null;
			return "send";
		}
		this.key = key;
		this.at = now;
		return "armed";
	}

	cancel(): void {
		this.key = null;
	}

	/** The armed ticket, or null when nothing is armed or the window has passed. */
	armed(now: number): string | null {
		if (this.key != null && now - this.at >= ARM_MS) this.key = null;
		return this.key;
	}
}
