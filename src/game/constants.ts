// Game-core constants for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

/** Number of columns in the Playfield (0-indexed 0..15). */
export const COLS = 16;

/** Number of rows in the Playfield (0-indexed 0..9, row 0 at the top). */
export const ROWS = 10;

/** Spawn columns for a new block: left, right (0-indexed). */
export const SPAWN_COLS = [7, 8] as const;

/** Spawn rows for a new block: top, bottom (0-indexed). */
export const SPAWN_ROWS = [0, 1] as const;

/** Backing-track tempo in beats per minute. */
export const BPM = 120;

/** Duration of one beat in milliseconds (60000 / BPM = 500 ms at 120 BPM). */
export const BEAT_MS = 60000 / BPM;

/** Time for the Timeline_Bar to cross a single column (0.25 s/col, Req 6.1). */
export const SWEEP_MS_PER_COL = 250;

/** Time for the Timeline_Bar to traverse all columns (4000 ms = 8 beats). */
export const SWEEP_PERIOD_MS = SWEEP_MS_PER_COL * COLS;

/** Interval between gravity ticks during normal play (one tick per beat). */
export const GRAVITY_INTERVAL_MS = BEAT_MS;
