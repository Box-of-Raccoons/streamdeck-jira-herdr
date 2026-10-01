import { describe, expect, it } from "vitest";

import { DialBrowser, SNAP_BACK_MS } from "../src/dial.js";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const idOf = (i: { id: string }) => i.id;

describe("DialBrowser", () => {
	it("shows herdr's current item until turned", () => {
		const b = new DialBrowser();
		expect(b.view(items, idOf, "c", 0)).toEqual({ item: { id: "c" }, index: 2, count: 4, current: true });
	});

	it("previews without switching, wrapping both ways", () => {
		const b = new DialBrowser();
		b.turn(items, idOf, "c", 1, 0);
		expect(b.view(items, idOf, "c", 10)).toMatchObject({ item: { id: "d" }, current: false });
		b.turn(items, idOf, "c", 1, 20);
		expect(b.view(items, idOf, "c", 30).item).toEqual({ id: "a" });
		b.turn(items, idOf, "c", -3, 40);
		expect(b.view(items, idOf, "c", 50).item).toEqual({ id: "b" });
	});

	it("commits the previewed item, then shows the current one again", () => {
		const b = new DialBrowser();
		b.turn(items, idOf, "c", -2, 0);
		expect(b.commit(items, idOf, "c", 10)).toBe("a");
		expect(b.previewing).toBe(false);
		expect(b.view(items, idOf, "c", 20).item).toEqual({ id: "c" });
	});

	it("commits nothing when the shown item is already current", () => {
		const b = new DialBrowser();
		expect(b.commit(items, idOf, "c", 0)).toBeNull();
		b.turn(items, idOf, "c", 4, 0); // full circle back to c
		expect(b.commit(items, idOf, "c", 10)).toBeNull();
	});

	it("snaps back after the quiet spell", () => {
		const b = new DialBrowser();
		b.turn(items, idOf, "c", 1, 1000);
		expect(b.view(items, idOf, "c", 1000 + SNAP_BACK_MS - 1).item).toEqual({ id: "d" });
		expect(b.view(items, idOf, "c", 1000 + SNAP_BACK_MS).item).toEqual({ id: "c" });
		expect(b.commit(items, idOf, "c", 1000 + SNAP_BACK_MS)).toBeNull();
	});

	it("drops a preview whose item vanished", () => {
		const b = new DialBrowser();
		b.turn(items, idOf, "c", 1, 0);
		expect(b.view(items.filter((i) => i.id !== "d"), idOf, "c", 10).item).toEqual({ id: "c" });
	});

	it("copes with an empty list", () => {
		const b = new DialBrowser();
		b.turn([], idOf, null, 1, 0);
		expect(b.view([], idOf, null, 0)).toEqual({ item: null, index: -1, count: 0, current: false });
		expect(b.commit([], idOf, null, 0)).toBeNull();
	});
});

