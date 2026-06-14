import { describe, expect, it } from "vitest";
import { ALL_CLEAR_BONUS, COLS, ROWS, SINGLE_COLOUR_BONUS } from "../core";
import { GameController } from "../engine/controller";
import {
  bonusLabel,
  bonusPoints,
  bonusPointsLabel,
  nextBonusFire,
} from "./bonus-banner";

/**
 * The BonusText overlay must fire its banner EXACTLY ONCE per board-state bonus
 * event (keyed by the monotonic `lastBonusClear.id`), distinctly per kind, with
 * the right point value. These tests pin the pure decision + presentation helpers
 * the component is built on, and drive the REAL controller to a genuine all-clear
 * so the fire-once-per-id logic is exercised against the actual event payload the
 * component subscribes to.
 */

describe("bonus text presentation helpers", () => {
  it("maps each kind to its label, points, and +N points string", () => {
    expect(bonusLabel("singleColour")).toBe("SINGLE COLOUR!");
    expect(bonusLabel("allClear")).toBe("ALL CLEAR!");

    expect(bonusPoints("singleColour")).toBe(SINGLE_COLOUR_BONUS);
    expect(bonusPoints("allClear")).toBe(ALL_CLEAR_BONUS);

    // Thousands-separated so the payoff reads (1,000 / 10,000).
    expect(bonusPointsLabel("singleColour")).toBe("+1,000");
    expect(bonusPointsLabel("allClear")).toBe("+10,000");
  });
});

describe("nextBonusFire (fire exactly once per event id)", () => {
  it("does not fire when there is no event", () => {
    expect(nextBonusFire(undefined, 0)).toEqual({ fire: false, lastFiredId: 0 });
  });

  it("fires once on a new id, then never again for the SAME id", () => {
    const ev = { id: 1, kind: "allClear" as const };
    const first = nextBonusFire(ev, 0);
    expect(first.fire).toBe(true);
    expect(first.kind).toBe("allClear");
    expect(first.lastFiredId).toBe(1);

    // Re-render with the same event must NOT re-fire.
    const second = nextBonusFire(ev, first.lastFiredId);
    expect(second.fire).toBe(false);
    expect(second.lastFiredId).toBe(1);
  });

  it("fires again when a strictly greater id arrives", () => {
    const next = nextBonusFire({ id: 5, kind: "singleColour" }, 1);
    expect(next.fire).toBe(true);
    expect(next.kind).toBe("singleColour");
    expect(next.lastFiredId).toBe(5);
  });

  it("re-syncs WITHOUT firing when the id goes backwards (a new game / reset)", () => {
    const reset = nextBonusFire({ id: 1, kind: "allClear" }, 7);
    expect(reset.fire).toBe(false);
    expect(reset.lastFiredId).toBe(1);
  });
});

describe("nextBonusFire against the REAL controller bonus event", () => {
  it("fires exactly once across repeated snapshots carrying the same all-clear event", () => {
    const c = new GameController({ testMode: true });

    // A lone clearable mono 2x2 -> the sweep empties the board (all-clear).
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);
    c.testSweepNow();

    const ev = c.getRenderState().lastBonusClear;
    expect(ev?.kind).toBe("allClear");

    // Simulate the component's per-snapshot loop: many emits carry the SAME event
    // object; the banner must fire on the first and stay silent thereafter.
    let lastFiredId = 0;
    let fireCount = 0;
    for (let i = 0; i < 5; i++) {
      const d = nextBonusFire(c.getRenderState().lastBonusClear, lastFiredId);
      lastFiredId = d.lastFiredId;
      if (d.fire) fireCount++;
    }
    expect(fireCount).toBe(1);
    expect(lastFiredId).toBe(ev!.id);
  });

  it("a SINGLE-COLOUR bonus reports kind singleColour to the overlay", () => {
    const c = new GameController({ testMode: true });
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);
    // a surviving isolated same-colour cell => single-colour (not empty) board.
    c.testSetCell(ROWS - 1, COLS - 1, 0);
    c.testSweepNow();

    const d = nextBonusFire(c.getRenderState().lastBonusClear, 0);
    expect(d.fire).toBe(true);
    expect(d.kind).toBe("singleColour");
  });
});
