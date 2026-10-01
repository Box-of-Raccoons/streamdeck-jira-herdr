/**
 * What a browsing dial is showing. Turning previews items without switching;
 * pressing (or tapping the strip) commits; after a quiet spell it snaps back to
 * whatever herdr has focused.
 */

export const SNAP_BACK_MS = 5_000;

export interface DialView<T> {
	item: T | null;
	index: number;
	count: number;
	/** True when the shown item is herdr's current one. */
	current: boolean;
}

export class DialBrowser {
	private previewId: string | null = null;
	private lastTurn = 0;

	/**
	 * What to show now. `ids` is the item list in display order, `currentId`
	 * herdr's focused one. A preview that has gone stale or vanished is dropped.
	 */
	view<T>(items: T[], idOf: (t: T) => string, currentId: string | null | undefined, now: number): DialView<T> {
		if (this.previewId != null && (now - this.lastTurn >= SNAP_BACK_MS || !items.some((t) => idOf(t) === this.previewId))) {
			this.previewId = null;
		}
		const shownId = this.previewId ?? currentId;
		let index = items.findIndex((t) => idOf(t) === shownId);
		if (index < 0 && items.length > 0) index = 0;
		const item = index >= 0 ? items[index] : null;
		return { item, index, count: items.length, current: item != null && idOf(item) === currentId };
	}

	/** Moves the preview `ticks` items (negative is back), wrapping. */
	turn<T>(items: T[], idOf: (t: T) => string, currentId: string | null | undefined, ticks: number, now: number): void {
		if (items.length === 0) return;
		const { index } = this.view(items, idOf, currentId, now);
		const next = (((index + ticks) % items.length) + items.length) % items.length;
		this.previewId = idOf(items[next]);
		this.lastTurn = now;
	}

	/** The id to switch to on press, or null when the shown item is already current. Ends the preview. */
	commit<T>(items: T[], idOf: (t: T) => string, currentId: string | null | undefined, now: number): string | null {
		const { item, current } = this.view(items, idOf, currentId, now);
		this.previewId = null;
		return item && !current ? idOf(item) : null;
	}

	/** True while a preview is showing; the action uses it to schedule the snap-back redraw. */
	get previewing(): boolean {
		return this.previewId != null;
	}
}
