/** Pinned game constants. Do not change without updating the specs. */

/** Grid width in columns. */
export const COLS = 16;
/** Grid height in rows. */
export const ROWS = 10;

/** Spawn position of the piece's top-left cell (columns 7-8, rows 0-1). */
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;

/** Tempo: 120 BPM -> one beat = 0.5s. */
export const BPM = 120;
export const SECONDS_PER_BEAT = 60 / BPM; // 0.5s

/** Sweep: full 16-column traversal = 8 beats = 4.0s -> 0.25s per column. */
export const SWEEP_BEATS_PER_TRAVERSAL = 8;
export const SWEEP_SECONDS_PER_TRAVERSAL =
  SWEEP_BEATS_PER_TRAVERSAL * SECONDS_PER_BEAT; // 4.0s
export const SWEEP_SECONDS_PER_COL = SWEEP_SECONDS_PER_TRAVERSAL / COLS; // 0.25s
export const SWEEP_MS_PER_COL = SWEEP_SECONDS_PER_COL * 1000; // 250ms
export const SWEEP_COLS_PER_SECOND = COLS / SWEEP_SECONDS_PER_TRAVERSAL; // 4 cols/s

/** Production gravity tick interval (ms). Not used in test mode. */
export const GRAVITY_INTERVAL_MS = 700;
/** Soft-drop gravity interval (ms) while soft-drop is engaged. */
export const SOFT_DROP_INTERVAL_MS = 60;

/** Backing track URL (served from public/). */
export const BACKING_TRACK_URL = "/backing-track.mp3";
