export const COLS = 16;
export const ROWS = 10;

// Piece spawn: top-left cell at row 0, col 7 (occupies rows 0-1, cols 7-8).
export const SPAWN_ROW = 0;
export const SPAWN_COL = 7;

// Timing (120 BPM => beat = 500ms; sweep = 8 beats = 4000ms over 16 cols).
export const BPM = 120;
export const BEAT_MS = 500;
export const SWEEP_BEATS = 8;
export const SWEEP_MS = 4000;
export const MS_PER_COL = SWEEP_MS / COLS; // 250

// Production-only cadence.
export const GRAVITY_TICK_MS = 700;
export const SOFT_DROP_TICK_MS = 60;

export const AUDIO_SRC = "/backing-track.mp3";
