import { describe, expect, it } from "vitest";
import {
  ALL_CLEAR_BONUS,
  COLS,
  ROWS,
  SINGLE_COLOUR_BONUS,
} from "../core";
import { GameController, type RenderState } from "./controller";

/**
 * FIX B (bonus celebrations don't show): the single-colour (1,000) and all-clear
 * (10,000) board-state bonuses already SCORE and emit a render-only event
 * (`RenderState.lastBonusClear`) that Scene3D turns into a wavefront wash. Rai
 * reported never seeing them. These integration tests drive the REAL controller
 * to a genuine single-colour board AND a genuine all-clear (built from the test
 * board seam, swept via the controller), and assert end to end that:
 *   (i)  the score jumps by the bonus,
 *   (ii) the render-only `lastBonusClear` bumps with the right `kind` + a fresh id,
 *   (iii) the event reaches the RENDER STATE a SUBSCRIBER sees (the exact object
 *        Scene3D consumes to seed the celebration), with cells to wash over.
 * If these pass, the score + event path is sound, so any "I never see it" is the
 * render/visibility side (addressed by the bigger/longer wash in Scene3D +
 * ChainWavefront) — not a missing or mis-derived event.
 *
 * The detection reads the SETTLED grid only (Lumines: only settled blocks count).
 * The active piece is never part of the bonus board state — these tests set the
 * settled cells directly and never leave an active piece in the bonus read.
 */

/** Capture the latest RenderState a subscriber sees (the Scene3D consumer path). */
function withSubscriber(c: GameController): { last: () => RenderState } {
  let latest: RenderState = c.getRenderState();
  c.subscribe((rs) => {
    latest = rs;
  });
  return { last: () => latest };
}

describe("board-state bonus celebration reaches the render path (FIX B)", () => {
  it("a clear that EMPTIES the board: score += ALL_CLEAR_BONUS and lastBonusClear bumps kind=allClear", () => {
    const c = new GameController({ testMode: true });
    const sub = withSubscriber(c);

    // A clearable mono 2x2 of colour 0 at the bottom-left — and NOTHING else, so
    // the sweep empties the whole board (all-clear).
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);

    expect(c.testState().score).toBe(0);

    c.testSweepNow();

    // (i) score jumped by the all-clear bonus (package(1 square)=40 + 10,000).
    const score = c.testState().score;
    expect(score).toBe(40 + ALL_CLEAR_BONUS);

    // (ii) the render-only event bumped, kind allClear, fresh id, cells present.
    const ev = c.getRenderState().lastBonusClear;
    expect(ev).toBeDefined();
    expect(ev!.kind).toBe("allClear");
    expect(ev!.id).toBeGreaterThan(0);
    expect(ev!.cells.length).toBeGreaterThan(0);

    // (iii) the SAME event reached the snapshot a subscriber (Scene3D) sees.
    const seen = sub.last().lastBonusClear;
    expect(seen).toBeDefined();
    expect(seen!.kind).toBe("allClear");
    expect(seen!.id).toBe(ev!.id);
    expect(seen!.cells.length).toBeGreaterThan(0);
  });

  it("a clear leaving a SINGLE-COLOUR board: score += SINGLE_COLOUR_BONUS and lastBonusClear bumps kind=singleColour", () => {
    const c = new GameController({ testMode: true });
    const sub = withSubscriber(c);

    // Clearable mono 2x2 of colour 0 (clears this pass)...
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);
    // ...plus an isolated colour-0 cell that forms NO square (survives), so the
    // post-clear board is non-empty and entirely colour 0 (single-colour bonus).
    c.testSetCell(ROWS - 1, COLS - 1, 0);

    c.testSweepNow();

    // (i) score jumped by the single-colour bonus (package(1)=40 + 1,000).
    expect(c.testState().score).toBe(40 + SINGLE_COLOUR_BONUS);

    // (ii) + (iii) the event bumped with kind singleColour + reached the renderer.
    const ev = c.getRenderState().lastBonusClear;
    expect(ev?.kind).toBe("singleColour");
    expect(ev!.cells).toContain((ROWS - 1) * COLS + (COLS - 1));

    const seen = sub.last().lastBonusClear;
    expect(seen?.kind).toBe("singleColour");
    expect(seen!.id).toBe(ev!.id);
  });

  it("the bonus fires the SAME way through the live advanceSweep path (testSweepProgress), not just runFullSweep", () => {
    // Rai's note: the controller uses advanceSweep in real play, not runFullSweep.
    // Drive the sweep across the whole board via the incremental progress seam and
    // assert the all-clear event still arrives.
    const c = new GameController({ testMode: true });
    const sub = withSubscriber(c);

    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);

    // Advance the sweep past the right edge in steps (advanceSweep under the hood).
    // 0.25s per column (SWEEP_MS_PER_COL); push well past COLS columns.
    for (let i = 0; i < COLS + 2; i++) c.testSweepProgress(250);

    expect(c.testState().score).toBe(40 + ALL_CLEAR_BONUS);
    const seen = sub.last().lastBonusClear;
    expect(seen?.kind).toBe("allClear");
    expect(seen!.cells.length).toBeGreaterThan(0);
  });

  it("a normal clear leaving a MIXED board does NOT fire a bonus (no false positives)", () => {
    const c = new GameController({ testMode: true });
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);
    // survivors of BOTH colours => multi-colour board after the clear.
    c.testSetCell(ROWS - 1, COLS - 1, 0);
    c.testSetCell(ROWS - 1, COLS - 2, 1);

    c.testSweepNow();

    expect(c.testState().score).toBe(40); // square only, no board bonus
    expect(c.getRenderState().lastBonusClear).toBeUndefined();
  });
});
