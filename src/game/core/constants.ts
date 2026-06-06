/** Pinned game constants. Do not change without updating the specs. */

/** Grid width in columns. */
export const COLS = 16;
/** Grid height in rows. */
export const ROWS = 10;

/**
 * Logical board aspect ratio, derived from the grid dimensions (NOT hard-coded).
 * Single source of truth for any layer that needs the playfield's shape (the
 * canvas CSS box, the React host container) so no renderer/layout inlines a
 * literal like "16 / 10". A CSS `aspect-ratio` value.
 */
export const BOARD_ASPECT = `${COLS} / ${ROWS}`;

/** Spawn position of the piece's top-left cell (columns 7-8, rows 0-1). */
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;

/** Tempo: 120 BPM -> one beat = 0.5s. */
export const BPM = 120;
export const SECONDS_PER_BEAT = 60 / BPM; // 0.5s

/**
 * Sweep cadence: one column per EIGHTH-NOTE = two columns per beat, so a full
 * 16-column traversal spans 8 eighth-notes... no: 16 eighth-notes = 8 beats =
 * two 4/4 bars. The controller uses this to convert absolute musical time into
 * an absolute sweep position (a pure function of the clock).
 */
export const COLS_PER_BEAT = 2; // one column per eighth-note

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

// --- V2 depth: scoring / specials / preview / progression ------------------

/** Base points per distinct square cleared in a pass. */
export const SQUARE_BASE_SCORE = 40;

/**
 * Cross-pass combo multiplier curve. A pass clearing >= 4 squares applies a
 * multiplier indexed by the consecutive-qualifying-pass count (`combo`), capped
 * at the final entry. A pass clearing < 4 squares applies x1 and resets combo.
 */
export const COMBO_CURVE = [4, 8, 12, 16] as const;

/** Minimum squares in one pass to trigger the combo multiplier. */
export const COMBO_MIN_SQUARES = 4;

/** Flat bonus when the settled field is reduced to a single colour. */
export const SINGLE_COLOUR_BONUS = 1000;
/** Flat bonus when the board is emptied of all locked cells. */
export const ALL_CLEAR_BONUS = 10000;

/**
 * Chain-special spawn rate: per-piece probability, decided at generation time
 * off the single in-state RNG. ~1 special per 30 pieces.
 */
export const SPECIAL_RATE = 1 / 30;

/** Preview depth: the UI shows the next 3 pieces. */
export const PREVIEW_DEPTH = 3;

/**
 * Squares-cleared threshold to advance to the next skin. Deterministic so a
 * seeded run advances skins reproducibly.
 */
export const SKIN_ADVANCE_THRESHOLD = 20;
