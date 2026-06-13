import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "./constants";
import { createGame } from "./grid";
import { hardDrop, spawnPiece } from "./piece";
import { advanceSweep } from "./sweep";
import type { GameState, Piece } from "./types";

/**
 * The pure core is load-bearing for the deterministic test seam and the eval:
 * `src/game/core/**` must never reach for ambient time, the DOM, or audio. This
 * test asserts that statically so a regression fails CI, not a playtest.
 */

const coreDir = fileURLToPath(new URL(".", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Identifiers that signal a clock / DOM / audio dependency leaking into core.
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "Date", pattern: /\bDate\b/ },
  { name: "performance", pattern: /\bperformance\b/ },
  { name: "AudioContext", pattern: /\bAudioContext\b/ },
  { name: "requestAnimationFrame", pattern: /\brequestAnimationFrame\b/ },
  { name: "setTimeout", pattern: /\bsetTimeout\b/ },
  { name: "setInterval", pattern: /\bsetInterval\b/ },
  // Importing the clock seam (time/ or audio/) from core is also forbidden.
  { name: "clock import", pattern: /from\s+["'][^"']*(time|audio)\/clock["']/ },
  { name: "any clock identifier", pattern: /\bClock\b/ },
];

/**
 * Per-file forbidden-pattern exemptions. `rng.ts` is the SOLE seed source: its
 * `randomSeed()` deliberately draws an initial seed from `crypto.getRandomValues`
 * with a `Date.now()` fallback (design D6). That is a one-off non-deterministic
 * seed draw, never called by any pure game op — so the determinism contract
 * ("same seed -> same run") is untouched. The `Date` reference there is therefore
 * sanctioned and exempt; every OTHER pattern (and every other file) is still
 * enforced verbatim.
 */
const EXEMPT: Record<string, ReadonlySet<string>> = {
  "rng.ts": new Set(["Date"]),
};

describe("core purity", () => {
  const files = tsFiles(coreDir);

  it("finds core source files to lint", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.split("/core/")[1]!;
    it(`no time/DOM/audio dependency in ${rel}`, () => {
      const src = readFileSync(file, "utf8");
      const exempt = EXEMPT[rel];
      for (const { name, pattern } of FORBIDDEN) {
        if (exempt?.has(name)) continue;
        expect(
          pattern.test(src),
          `${file} references forbidden "${name}"`,
        ).toBe(false);
      }
    });
  }
});

describe("D8 telemetry is record-only (no gameplay effect)", () => {
  const MONO: Piece = [
    [0, 0],
    [0, 0],
  ];

  function clearableBoard(): GameState {
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    return base;
  }

  it("advanceSweep deletion + score are identical whether or not prior telemetry is present", () => {
    const a = advanceSweep(clearableBoard(), COLS);
    // Seed the next call's state with arbitrary prior telemetry: it must not change
    // the deletion result or the score.
    const seeded: GameState = {
      ...clearableBoard(),
      lastPassComplete: { id: 99, squares: 7, comboMultiplier: 4, groupErases: [] },
      lastLock: { id: 42, cause: "hard" },
    };
    const b = advanceSweep(seeded, COLS);
    expect(b.grid).toEqual(a.grid);
    expect(b.score).toBe(a.score);
    expect(b.specials).toEqual(a.specials);
  });

  it("lockPiece settles + scores identically regardless of prior lastLock", () => {
    const plain = hardDrop(spawnPiece(createGame(), MONO));
    const seeded = hardDrop(
      spawnPiece({ ...createGame(), lastLock: { id: 5, cause: "soft" } }, MONO),
    );
    expect(seeded.grid).toEqual(plain.grid);
    expect(seeded.score).toBe(plain.score);
    // The event itself advances (bumped id), but the GAME outcome is unchanged.
    expect(seeded.lastLock?.id).toBe(6);
  });
});
