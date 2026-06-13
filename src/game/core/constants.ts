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

/**
 * Spawn position of the piece's top-left cell. Columns 7-8; ROW = -2 so the 2x2
 * STAGES ABOVE the visible field (top cell at row -2, bottom at row -1) and
 * descends into the 16x10 field under gravity (audit A5/D4). The visible field's
 * top two rows are therefore fully usable for stacking, and game over is decided
 * by whether the piece can ENTER the field, not by the spawn row being occupied.
 */
export const SPAWN_COL = 7;
export const SPAWN_ROW = -2;

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

/**
 * Float tolerance for "the sweep reached the right edge / a pass completed".
 * `advanceSweep` wraps when `sweepX >= COLS - SWEEP_WRAP_EPSILON`; any other
 * layer that decides "a pass completed this frame" (e.g. the controller's tempo
 * latch) MUST use the same tolerance so it never lags a real wrap by an epsilon.
 */
export const SWEEP_WRAP_EPSILON = 1e-9;

/** Production gravity tick interval (ms). Not used in test mode. */
export const GRAVITY_INTERVAL_MS = 700;
/** Soft-drop gravity interval (ms) while soft-drop is engaged. */
export const SOFT_DROP_INTERVAL_MS = 60;

/**
 * New-block hold window (ms): a freshly spawned piece holds at the top for one
 * beat before gravity resumes, so placement is deliberate and a carried-over
 * drop key cannot cascade into the next piece. Pinned to one beat at 120 BPM.
 */
export const HOLD_MS = SECONDS_PER_BEAT * 1000; // 500ms (one beat)

/** Backing track URL (served from public/). */
export const BACKING_TRACK_URL = "/backing-track.mp3";

// --- V2 depth: scoring / specials / preview / progression ------------------

/** Base points per distinct square cleared in a pass (1-3 squares). */
export const SQUARE_BASE_SCORE = 40;

/**
 * Single-sweep big-clear package (faithful Lumines, README §3b item 5; audit
 * A7/D1). A pass clearing >= `BIG_CLEAR_THRESHOLD` distinct squares scores
 * `BIG_CLEAR_BASE + (squares - THRESHOLD) * BIG_CLEAR_STEP`, i.e. 4 = 640,
 * 5 = 800, 6 = 960. This package (NOT a linear per-square value) is the base any
 * house multiplier multiplies.
 */
export const BIG_CLEAR_THRESHOLD = 4;
export const BIG_CLEAR_BASE = 640;
export const BIG_CLEAR_STEP = 160;

/**
 * Cross-pass STREAK multiplier curve (Lumines II+ house mechanic, design D3).
 * Applied to the WHOLE faithful pass package, indexed by the consecutive-
 * qualifying-pass count (`combo`), capped at the final entry. A pass clearing
 * < BIG_CLEAR_THRESHOLD squares applies x1 and resets the streak.
 *
 * The big-clear package ALREADY contains the single-sweep x4 (640 + 160(n-4) ≡
 * 40n × 4 for n >= 4), so this curve is `[1, 2, 3, 4]` — NOT the legacy
 * `[4, 8, 12, 16]`, which would double-count the x4 and pay a first qualifying
 * pass 2560 instead of 640. Consecutive 4-square passes therefore pay
 * 640 → 1280 → 1920 → 2560.
 */
export const STREAK_CURVE = [1, 2, 3, 4] as const;

/** Minimum squares in one pass to trigger the streak multiplier / big-clear. */
export const COMBO_MIN_SQUARES = 4;

/** Flat bonus when the settled field is reduced to a single colour. */
export const SINGLE_COLOUR_BONUS = 1000;
/** Flat bonus when the board is emptied of all locked cells. */
export const ALL_CLEAR_BONUS = 10000;

/**
 * Chain-special spawn rate: per-piece probability, decided at generation time
 * off the single in-state RNG. ~1 special per 14 pieces — raised from 1/30 so
 * gems are actually PRESENT in normal play (at 1/30 a several-minute session
 * saw almost none). Single source of truth; the renderer never duplicates it.
 */
export const SPECIAL_RATE = 1 / 14;

/** Preview depth: the UI shows the next 3 pieces. */
export const PREVIEW_DEPTH = 3;
