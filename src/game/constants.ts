export const GRID_COLS = 16;
export const GRID_ROWS = 10;

/** Spawn position: top-left corner of the 2×2 piece. */
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;

/** Gravity tick interval in milliseconds. */
export const GRAVITY_INTERVAL = 800;

/** Full sweep traversal time in milliseconds (8 beats at 120 BPM). */
export const SWEEP_PERIOD = 4000;

/** Time per column in milliseconds. */
export const MS_PER_COLUMN = SWEEP_PERIOD / GRID_COLS; // 250ms

/** Soft-drop repeat interval in milliseconds. */
export const SOFT_DROP_INTERVAL = 50;

/** DAS initial delay in milliseconds. */
export const DAS_DELAY = 233;

/** DAS repeat interval in milliseconds. */
export const DAS_REPEAT = 133;

/** Cell size in pixels for rendering. */
export const CELL_SIZE = 40;
