import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "../core";

/**
 * Static guard for the playfield-grid spec: the renderer's board dimensions
 * MUST derive from the shared COLS/ROWS constants, and no layer may re-hardcode
 * a grid width (in particular the literal 10, the value Rai suspected). Biome /
 * typecheck cannot catch a stray literal width, so we assert it here.
 */
const rendererSrc = readFileSync(
  fileURLToPath(new URL("./renderer.ts", import.meta.url)),
  "utf8",
);

describe("renderer board dims derive from constants (6.2)", () => {
  it("BOARD_W and BOARD_H are derived from COLS*CELL and ROWS*CELL", () => {
    expect(rendererSrc).toMatch(/BOARD_W\s*=\s*COLS\s*\*\s*CELL/);
    expect(rendererSrc).toMatch(/BOARD_H\s*=\s*ROWS\s*\*\s*CELL/);
  });

  it("does not hard-code a grid width/height literal where the constant belongs", () => {
    // Strip comments + string literals (the CELL=40 constant and colour hex are
    // fine; we only care about loop bounds / dimension math using a raw 10/16).
    const code = rendererSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
    // A grid dimension leaks as a LOOP BOUND: `< 16`, `<= 10`, `< 10` etc. Every
    // column/row loop bound must reference COLS/ROWS, never a bare 16 or 10.
    // (Visual magic numbers like a `* 10` flash-growth size are not grid bounds.)
    expect(code).not.toMatch(/[<>]=?\s*1[06]\b/);
  });

  it("constants are the canonical 16x10", () => {
    expect(COLS).toBe(16);
    expect(ROWS).toBe(10);
  });
});
