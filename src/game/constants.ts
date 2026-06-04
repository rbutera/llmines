// Pinned game constants for LLMines. See specs/001-llmines-game/data-model.md.

export const GRID_COLS = 16;
export const GRID_ROWS = 10;

// Spawn position: 2x2 piece occupies columns 7-8, rows 0-1 (0-indexed).
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;

export const COLORS = 2; // A = 0, B = 1

// Tempo: 120 BPM => one beat = 500ms.
export const BEAT_MS = 500;
// The timeline bar crosses the full field in 8 beats.
export const SWEEP_BEATS = 8;
export const SWEEP_FULL_MS = SWEEP_BEATS * BEAT_MS; // 4000ms
// Per-column sweep duration: 4000 / 16 = 250ms/col.
export const SWEEP_MS_PER_COL = SWEEP_FULL_MS / GRID_COLS; // 250

// Production auto-fall cadence (not asserted by the test suite).
export const GRAVITY_TICK_MS = 700;
export const SOFT_DROP_TICK_MS = 60;

export const BACKING_TRACK_SRC = "/backing-track.mp3";
