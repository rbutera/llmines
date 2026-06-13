/**
 * Pure game-core types. No React / Pixi / DOM / time imports anywhere in
 * `src/game/core/**` — this module is the single source of truth and is fully
 * unit-testable.
 */

/** The two block colours: A = 0, B = 1. */
export type Color = 0 | 1;

/**
 * A cell of an ordered chain-flood component paired with its BFS distance from
 * the origin chain cell (re-exported shape, used by the render-only
 * `lastChainClear` record). Defined here to keep `types.ts` the single source of
 * truth for state shapes; `chain.ts` exports the canonical {@link OrderedCell}.
 */
export interface OrderedCell {
  /** Row-major index (`row * COLS + col`). */
  cell: number;
  /** BFS distance (orthogonal steps) from the origin cell; origin is 0. */
  dist: number;
}

/** A grid cell: a colour, or null when empty. */
export type Cell = Color | null;

/** Grid is addressed `grid[row][col]`; row 0 = TOP. 10 rows x 16 cols. */
export type Grid = Cell[][];

/** A 2x2 piece: [topRow, bottomRow], each row [left, right]. */
export type Piece = [[Color, Color], [Color, Color]];

/** Position of a piece's top-left cell. */
export interface PiecePos {
  row: number;
  col: number;
}

/**
 * A generated piece plus its (generation-time) chain-special decision. The
 * special is decided when the piece is generated so it can be shown in the
 * preview queue before it spawns. `cellIndex` is 0..3 reading the 2x2 in
 * row-major order: 0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right.
 */
export interface GeneratedPiece {
  cells: Piece;
  /** Present when this piece carries a chain special on one of its cells. */
  special?: { cellIndex: 0 | 1 | 2 | 3 };
}

/** The active, still-falling piece. */
export interface ActivePiece {
  cells: Piece;
  pos: PiecePos;
  /** If this piece carries a chain special, which of its 4 cells holds it. */
  special?: { cellIndex: 0 | 1 | 2 | 3 };
}

/**
 * Spawn-hold state for the active piece. While `active`, gravity is suspended
 * (the piece "holds" at the top); `remainingMs` is the wall-clock time left in
 * the hold window, decremented by the controller (core stays time-free).
 */
export interface HoldState {
  active: boolean;
  remainingMs: number;
}

/** A marked cell coordinate. */
export interface MarkedCell {
  row: number;
  col: number;
}

/** Result of square detection over the settled grid. */
export interface MarkResult {
  marked: MarkedCell[];
  /** Number of distinct completed 2x2 squares (by top-left corner). */
  distinctSquares: number;
}

/**
 * One contiguous-group erase recorded during a sweep pass (audit A3 / D2). A
 * group is a run of contiguous marked columns erased as a single batch when the
 * bar reaches a gap (a column with no marks) or the right edge. RECORD-ONLY: the
 * `cells` (each `row * COLS + col`) and the `hadChain` flag feed the audio
 * layer's pass-completion telemetry (design D8); they never influence deletion,
 * scoring, or timing.
 */
export interface GroupErase {
  /** Coordinates (`row * COLS + col`) erased in this batch. */
  cells: number[];
  /** Whether a chain flood fired inside this batch. */
  hadChain: boolean;
}

/**
 * Internal sweep-pass tracking. A "pass" is one full left-to-right traversal.
 *
 * Marks are set INCREMENTALLY as the bar's leading edge reaches each column
 * (design D1, audit A2) — NOT snapshotted once at pass start. A square completed
 * ahead of the bar is therefore picked up when the edge reaches its left (anchor)
 * column and clears on the CURRENT pass. `distinctSquares` accumulates (deduped
 * by top-left corner) as squares are marked, used for scoring at the right edge.
 * Not exposed by the test `state()`.
 */
export interface SweepPass {
  /**
   * Which cells are marked for deletion, as a ROWS x COLS boolean grid
   * (`marks[row][col]`). Set incrementally by `markColumn` as the edge crosses
   * columns. Identity-based, NOT a fixed (row,col) list: when a chain flood
   * empties cells and the column settles, the marks fall with their cells
   * (mark-aware settle), so erasure always targets the originally-marked cell
   * wherever gravity has since moved it — never an innocent cell that happened to
   * land on a stale row.
   */
  marks: boolean[][];
  /**
   * Distinct completed 2x2 squares MARKED so far this pass, deduped by their
   * top-left (anchor) corner. Accumulates as the edge crosses columns; used to
   * bank scoring at the right edge. (No longer a pass-start snapshot.)
   */
  distinctSquares: number;
  /**
   * Top-left corner coordinates (`row * COLS + col`) of squares already counted
   * into `distinctSquares` this pass, so a square whose cells span two crossed
   * columns is never double-counted.
   */
  countedCorners: Set<number>;
  /** The leftmost column of the current contiguous marked run, or -1 if none. */
  runStart: number;
  /** Cells actually erased so far this pass. */
  deletedCount: number;
  /** Columns already processed (0..COLS). */
  processedCols: number;
  /**
   * RECORD-ONLY (design D8): the contiguous-group erases this pass, in erase
   * order. Populated by `eraseGroup`; attached to `lastPassComplete` at the right
   * edge. No gameplay effect.
   */
  groupErases: GroupErase[];
}

/**
 * Full deterministic game state. Settled stack (`grid`) and the falling piece
 * (`active`) are kept distinct internally; `viewGrid()` composites them.
 */
export interface GameState {
  grid: Grid;
  active: ActivePiece | null;
  score: number;
  gameOver: boolean;
  /** Sweep column position, float in [0, 16]. */
  sweepX: number;
  /**
   * The raw seed this game was created from (uint32), distinct from the evolving
   * `rngState`. Stored so the run can be surfaced (HUD / game-over) and replayed
   * (seed + ordered inputs reproduce the run). Set once by `createGame(seed)`.
   */
  seed: number;
  /** Mulberry32 RNG state (uint32). */
  rngState: number;
  /** Spawn-hold for the active piece (gravity suspended while `active`). */
  hold: HoldState;
  /** Active sweep pass, or null when none is in progress. Internal. */
  sweepPass?: SweepPass | null;
  /**
   * Consecutive qualifying-pass count (each clearing >= 4 squares). Indexes the
   * combo multiplier curve; reset to 0 by any pass clearing < 4 squares.
   */
  combo: number;
  /**
   * Coordinates (`row * COLS + col`) of settled cells that carry a chain
   * special. Sparse; parallel to the cell colour in `grid`.
   */
  specials: Set<number>;
  /**
   * Pre-generated upcoming pieces (depth >= PREVIEW_DEPTH + 1). The head spawns
   * next; drawn in the canonical RNG order so a seeded run is reproducible.
   */
  queue: GeneratedPiece[];
  /**
   * RECORD-ONLY (render-only), additive: the most recent chain-flood clear,
   * carrying the ordered component (origin + each cleared cell's BFS distance)
   * and a monotonic `id` so the renderer fires the travelling-wavefront effect
   * exactly once per event. Set by the sweep when a chain flood occurs; carried
   * forward unchanged on subsequent states until the next chain clear. Never read
   * by gameplay/scoring/timing — the deletion result is identical with or without
   * it. `undefined` until the first chain clear of the game.
   */
  lastChainClear?: { origin: number; cells: OrderedCell[]; id: number };
  /**
   * Soft-drop points accrued for the CURRENT piece but not yet banked. Real
   * Lumines awards soft-drop points only when the piece settles (locks), as a
   * single increment — never per descended row in realtime. `softDrop` adds one
   * here per row descended; `lockPiece` flushes it into `score` and resets it to
   * 0; spawning a new piece also resets it.
   */
  softDropBonus: number;
  /**
   * RECORD-ONLY (design D8, audio-truth contract): the most recent pass-
   * completion event, emitted by `advanceSweep` when a pass completes at the
   * right edge. Carries a monotonic `id` (the consumer fires once per new id), the
   * `squares` cleared this pass, the `comboMultiplier` actually applied to the
   * package, and the per-group `groupErases` (each group's erased cell coords +
   * whether a chain flood fired). Carried forward unchanged between passes (the
   * monotonic id means an unchanged value never re-fires), exactly like
   * `lastChainClear`. Never read by gameplay/scoring/timing — additive and record-
   * only, so it cannot affect determinism. `undefined` until the first pass
   * completion that cleared something / first completed pass.
   */
  lastPassComplete?: {
    id: number;
    squares: number;
    comboMultiplier: number;
    groupErases: GroupErase[];
  };
  /**
   * RECORD-ONLY (design D8, audio-truth contract): the most recent lock event,
   * emitted whenever a piece locks, carrying a monotonic `id` and the `cause`
   * (`gravity` | `soft` | `hard`) so the audio layer can route the right
   * lock/thud SFX (fixes B4's "lock only audible on hard drop"). Carried forward
   * unchanged between locks. Never read by gameplay/scoring/timing.
   * `undefined` until the first lock.
   */
  lastLock?: { id: number; cause: "gravity" | "soft" | "hard" };
}
