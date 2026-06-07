import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLS, ROWS, SPAWN_COLS, SPAWN_ROWS } from "~/game/constants";
import { createEngine, type GameEngine } from "~/game/engine";
import {
  installTestApi,
  type Screen,
  type TestApiContext,
} from "~/app/_game/testApi";

// installTestApi only touches `window` (no real DOM APIs), so a minimal stubbed
// global window keeps the node test environment (used by the rest of the suite)
// intact while still exercising the install path.
beforeEach(() => {
  (globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Build a real engine plus a fake context whose React hooks are spies. */
function setup(): {
  engine: GameEngine;
  ctx: TestApiContext;
  setScreen: ReturnType<typeof vi.fn>;
  notifyChange: ReturnType<typeof vi.fn>;
} {
  const engine = createEngine();
  const setScreen = vi.fn<(s: Screen) => void>();
  const notifyChange = vi.fn<() => void>();
  const ctx: TestApiContext = {
    engine,
    getScreen: () => "playing",
    setScreen,
    notifyChange,
  };
  return { engine, ctx, setScreen, notifyChange };
}

describe("installTestApi", () => {
  it("installs window.__lumines with the full imperative surface", () => {
    const { ctx } = setup();
    installTestApi(ctx);

    const api = window.__lumines;
    expect(api).toBeDefined();
    for (const name of [
      "seed",
      "state",
      "marked",
      "spawn",
      "tick",
      "sweepNow",
      "sweepProgress",
    ] as const) {
      expect(typeof api?.[name]).toBe("function");
    }
  });

  it("state() returns a composite snapshot with the right shape", () => {
    const { ctx } = setup();
    installTestApi(ctx);
    const api = window.__lumines!;

    const s = api.state();
    expect(Array.isArray(s.grid)).toBe(true);
    expect(s.grid.length).toBe(ROWS);
    for (const row of s.grid) {
      expect(row.length).toBe(COLS);
    }
    expect(typeof s.score).toBe("number");
    expect(typeof s.gameOver).toBe("boolean");
    expect(typeof s.sweepX).toBe("number");
  });

  it("seed() then spawn() places the piece at the spawn position", () => {
    const { ctx, notifyChange } = setup();
    installTestApi(ctx);
    const api = window.__lumines!;

    api.seed(123);
    api.spawn([
      [0, 0],
      [0, 0],
    ]);

    const grid = api.state().grid;
    const [topRow, bottomRow] = SPAWN_ROWS;
    const [leftCol, rightCol] = SPAWN_COLS;
    expect(grid[topRow]?.[leftCol]).toBe(0);
    expect(grid[topRow]?.[rightCol]).toBe(0);
    expect(grid[bottomRow]?.[leftCol]).toBe(0);
    expect(grid[bottomRow]?.[rightCol]).toBe(0);
    expect(notifyChange).toHaveBeenCalled();
  });

  it("marked() returns an array of coordinates", () => {
    const { ctx } = setup();
    installTestApi(ctx);
    const api = window.__lumines!;

    const marked = api.marked();
    expect(Array.isArray(marked)).toBe(true);
  });

  it("spawn() ignores an invalid piece with a console warning", () => {
    const { ctx, notifyChange } = setup();
    installTestApi(ctx);
    const api = window.__lumines!;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Intentionally malformed piece (wrong shape / out-of-range colour).
    api.spawn([[2, 0]] as unknown as Parameters<typeof api.spawn>[0]);
    expect(warn).toHaveBeenCalled();
    // Nothing was spawned, so no settled/active cells appear.
    const grid = api.state().grid;
    const occupied = grid.flat().filter((c) => c !== null).length;
    expect(occupied).toBe(0);
    expect(notifyChange).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
