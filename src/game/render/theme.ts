export const CELL = 38; // px per cell
export const GAP = 2; // inner padding inside a cell
export const BOARD_BG = 0x0b0f1a;
export const GRID_LINE = 0x1c2740;

// Two-colour palette (A = 0, B = 1) — Lumines-ish cool/warm contrast.
export const COLOR_A = 0x4cc2ff; // cyan
export const COLOR_A_HI = 0x9ee3ff;
export const COLOR_B = 0xff7ad9; // magenta
export const COLOR_B_HI = 0xffc4ef;

export const SWEEP = 0xfff4b0;
export const MARK_RING = 0xffffff;

export function cellFill(color: 0 | 1): number {
  return color === 0 ? COLOR_A : COLOR_B;
}
export function cellHi(color: 0 | 1): number {
  return color === 0 ? COLOR_A_HI : COLOR_B_HI;
}
