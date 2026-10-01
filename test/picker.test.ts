import { describe, expect, it } from "vitest";

import { ARM_MS, ArmGuard, TicketCursor } from "../src/picker.js";

const keyOf = (s: string) => s;

describe("TicketCursor", () => {
	it("starts at the top and wraps both ways", () => {
		const c = new TicketCursor();
		const list = ["A-1", "A-2", "A-3"];
		expect(c.view(list, keyOf)).toEqual({ item: "A-1", index: 0, count: 3 });
		c.turn(list, keyOf, -1);
		expect(c.view(list, keyOf).item).toBe("A-3");
		c.turn(list, keyOf, 2);
		expect(c.view(list, keyOf).item).toBe("A-2");
	});

	it("follows its ticket when a refresh reorders the list", () => {
		const c = new TicketCursor();
		c.turn(["A-1", "A-2", "A-3"], keyOf, 1);
		expect(c.view(["A-3", "A-1", "A-2"], keyOf)).toEqual({ item: "A-2", index: 2, count: 3 });
	});

	it("stays at the same position when its ticket leaves the list", () => {
		const c = new TicketCursor();
		c.turn(["A-1", "A-2", "A-3"], keyOf, 1);
		expect(c.view(["A-1", "A-3"], keyOf).item).toBe("A-3");
		c.turn(["A-1", "A-2", "A-3", "A-4"], keyOf, 1); // A-3 to A-4
		expect(c.view(["A-1", "A-2"], keyOf).item).toBe("A-2");
	});

	it("handles an empty list and resets to the top", () => {
		const c = new TicketCursor();
		expect(c.view([], keyOf)).toEqual({ item: null, index: 0, count: 0 });
		c.turn([], keyOf, 3);
		c.turn(["A-1", "A-2"], keyOf, 1);
		c.reset();
		expect(c.view(["A-1", "A-2"], keyOf).item).toBe("A-1");
	});
});

describe("ArmGuard", () => {
	it("arms on the first press and sends on the second within the window", () => {
		const g = new ArmGuard();
		expect(g.press("A-1", 0)).toBe("armed");
		expect(g.armed(100)).toBe("A-1");
		expect(g.press("A-1", ARM_MS - 1)).toBe("send");
		expect(g.armed(ARM_MS)).toBeNull();
	});

	it("does not send a third press right after sending", () => {
		const g = new ArmGuard();
		g.press("A-1", 0);
		g.press("A-1", 10);
		expect(g.press("A-1", 20)).toBe("armed");
	});

	it("re-arms instead of sending once the window has passed", () => {
		const g = new ArmGuard();
		g.press("A-1", 0);
		expect(g.armed(ARM_MS)).toBeNull();
		expect(g.press("A-1", ARM_MS)).toBe("armed");
	});

	it("re-arms when the second press is on another ticket", () => {
		const g = new ArmGuard();
		g.press("A-1", 0);
		expect(g.press("A-2", 10)).toBe("armed");
		expect(g.armed(20)).toBe("A-2");
	});

	it("is cancelled by a turn", () => {
		const g = new ArmGuard();
		g.press("A-1", 0);
		g.cancel();
		expect(g.armed(10)).toBeNull();
		expect(g.press("A-1", 20)).toBe("armed");
	});
});
