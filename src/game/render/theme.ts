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
export const SWEEP_CORE = 0xffffff;
export const MARK_RING = 0xffffff;
export const FLASH = 0xffffff;

// Beat = 500ms (120 BPM). Used to phase visual pulses to the music.
export const BEAT_MS = 500;

// Animation tuning (ms / rates).
export const APPEAR_MS = 120; // fade + scale-in when a cell enters
export const CLEAR_MS = 160; // white flash + scale-out when a cell leaves
export const SETTLE_K = 0.022; // lerp rate (per ms) for y easing toward target

export function cellFill(color: 0 | 1): number {
  return color === 0 ? COLOR_A : COLOR_B;
}
export function cellHi(color: 0 | 1): number {
  return color === 0 ? COLOR_A_HI : COLOR_B_HI;
}
