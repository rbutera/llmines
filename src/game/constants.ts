/**
 * Pinned game constants for LLMines (a Lumines clone).
 * These values are fixed by the spec and must not drift.
 */

/** Grid is 16 columns wide. */
export const COLS = 16;
/** Grid is 10 rows tall. */
export const ROWS = 10;

/** A piece is a 2x2 block of 4 cells. */
export const PIECE_SIZE = 2;

/**
 * Spawn position (pinned): the 2x2 piece spawns at columns 7-8 (0-indexed),
 * rows 0-1, i.e. top-left corner at (row 0, col 7).
 */
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;

/** Backing track tempo. */
export const BPM = 120;
/** One beat in seconds (= 0.5s at 120 BPM). */
export const BEAT_SECONDS = 60 / BPM;
/** The timeline bar crosses the full field in 8 beats. */
export const SWEEP_BEATS = 8;
/** Full traversal time in seconds (= 4.0s at 120 BPM). */
export const SWEEP_PERIOD_SECONDS = SWEEP_BEATS * BEAT_SECONDS;
/** Full traversal time in milliseconds (= 4000ms). */
export const SWEEP_PERIOD_MS = SWEEP_PERIOD_SECONDS * 1000;
/** Milliseconds for the bar to cross a single column (= 250ms). */
export const SWEEP_MS_PER_COL = SWEEP_PERIOD_MS / COLS;
/** Columns the bar advances per millisecond. */
export const SWEEP_COLS_PER_MS = COLS / SWEEP_PERIOD_MS;

/** Gravity timing for live (non-test) play. */
export const GRAVITY_INTERVAL_MS = 800;
/** Gravity timing while soft-dropping (`j` held). */
export const SOFT_DROP_INTERVAL_MS = 55;

/** Path to the looping backing track served from /public. */
export const BACKING_TRACK_SRC = "/backing-track.mp3";
