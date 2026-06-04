export const GRID_COLUMNS = 16;
export const GRID_ROWS = 10;
export const PIECE_SIZE = 2;
export const SPAWN_COL = 7;
export const SPAWN_ROW = 0;
export const COLORS = [0, 1] as const;
export const BPM = 120;
export const BEAT_MS = 60_000 / BPM;
export const SWEEP_BEATS = 8;
export const SWEEP_PERIOD_MS = BEAT_MS * SWEEP_BEATS;
export const COLUMN_SWEEP_MS = SWEEP_PERIOD_MS / GRID_COLUMNS;
export const BACKING_TRACK_SRC = "/backing-track.mp3";
export const NORMAL_GRAVITY_MS = 700;
export const SOFT_DROP_GRAVITY_MS = 90;
export const CELL_SIZE = 34;
export const BOARD_GAP = 2;
export const BOARD_WIDTH = GRID_COLUMNS * CELL_SIZE;
export const BOARD_HEIGHT = GRID_ROWS * CELL_SIZE;
export const COLOR_HEX = {
  0: 0x25f3ff,
  1: 0xffd23f,
} as const;
