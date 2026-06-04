export const COLS = 16;
export const ROWS = 10;
export const SPAWN_X = 7;
export const SPAWN_Y = 0;
export const BPM = 120;
export const BEAT_MS = 60_000 / BPM;
export const SWEEP_BEATS = 8;
export const SWEEP_MS = BEAT_MS * SWEEP_BEATS;
export const MS_PER_COL = SWEEP_MS / COLS;

export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][];
export type Piece = [[Color, Color], [Color, Color]];

export interface ActivePiece {
  x: number;
  y: number;
  cells: Piece;
}

export interface MarkedCell {
  row: number;
  col: number;
}

export interface SquareMarkResult {
  cells: MarkedCell[];
  distinctSquares: number;
}

export interface EngineState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
}

const emptyRow = (): Cell[] => Array.from<Cell>({ length: COLS }).fill(null);

export function createEmptyGrid(): Grid {
  return Array.from({ length: ROWS }, emptyRow);
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

const keyFor = (row: number, col: number) => `${row}:${col}`;

export class LuminesEngine {
  private settled: Grid = createEmptyGrid();
  private active: ActivePiece | null = null;
  private rngState = 0x1a2b3c4d;
  private sweepPosition = 0;

  score = 0;
  gameOver = false;

  seed(n: number): void {
    this.rngState = n >>> 0;
  }

  reset(): void {
    this.settled = createEmptyGrid();
    this.active = null;
    this.score = 0;
    this.gameOver = false;
    this.sweepPosition = 0;
  }

  getActive(): ActivePiece | null {
    return this.active
      ? { x: this.active.x, y: this.active.y, cells: clonePiece(this.active.cells) }
      : null;
  }

  getSettledGrid(): Grid {
    return cloneGrid(this.settled);
  }

  state(): EngineState {
    return {
      grid: this.gridWithActive(),
      score: this.score,
      gameOver: this.gameOver,
      sweepX: this.sweepPosition,
    };
  }

  marked(): MarkedCell[] {
    return this.detectSquares().cells;
  }

  spawn(piece?: Piece): boolean {
    if (this.gameOver) return false;

    if (this.active) {
      this.lockActive();
    }

    const nextPiece = piece ? clonePiece(piece) : this.randomPiece();
    const candidate: ActivePiece = { x: SPAWN_X, y: SPAWN_Y, cells: nextPiece };

    if (!this.canPlace(candidate.x, candidate.y, candidate.cells)) {
      this.active = null;
      this.gameOver = true;
      return false;
    }

    this.active = candidate;
    return true;
  }

  tick(autoSpawn = false): void {
    if (this.gameOver) return;

    if (!this.active) {
      if (autoSpawn) this.spawn();
      return;
    }

    if (this.canPlace(this.active.x, this.active.y + 1, this.active.cells)) {
      this.active = { ...this.active, y: this.active.y + 1 };
      return;
    }

    this.lockActive();
    if (autoSpawn && !this.gameOver) this.spawn();
  }

  move(dx: number): void {
    if (!this.active || this.gameOver) return;
    const nextX = this.active.x + dx;
    if (this.canPlace(nextX, this.active.y, this.active.cells)) {
      this.active = { ...this.active, x: nextX };
    }
  }

  rotate(): void {
    if (!this.active || this.gameOver) return;
    const rotated = rotatePiece(this.active.cells);
    const offsets = [0, -1, 1, -2, 2];
    const offset = offsets.find((dx) =>
      this.canPlace(this.active!.x + dx, this.active!.y, rotated),
    );
    if (offset !== undefined) {
      this.active = { ...this.active, x: this.active.x + offset, cells: rotated };
    }
  }

  hardDrop(autoSpawn = false): void {
    if (!this.active || this.gameOver) return;
    while (this.canPlace(this.active.x, this.active.y + 1, this.active.cells)) {
      this.active = { ...this.active, y: this.active.y + 1 };
    }
    this.lockActive();
    if (autoSpawn && !this.gameOver) this.spawn();
  }

  sweepNow(): void {
    this.clearColumns(Array.from({ length: COLS }, (_, col) => col));
    this.sweepPosition = 0;
  }

  sweepProgress(dtMs: number): void {
    if (dtMs <= 0) return;

    const start = this.sweepPosition;
    const rawEnd = start + (dtMs / SWEEP_MS) * COLS;
    const columns: number[] = [];

    for (let boundary = Math.floor(start) + 1; boundary <= Math.floor(rawEnd); boundary += 1) {
      columns.push((boundary - 1) % COLS);
    }

    this.sweepPosition = rawEnd % COLS;
    this.clearColumns([...new Set(columns)]);
  }

  private clearColumns(columns: number[]): void {
    if (columns.length === 0) return;

    const result = this.detectSquares();
    if (result.distinctSquares === 0) return;

    const columnSet = new Set(columns);
    const cellsToClear = result.cells.filter((cell) => columnSet.has(cell.col));
    if (cellsToClear.length === 0) return;

    for (const { row, col } of cellsToClear) {
      this.settled[row]![col] = null;
    }

    this.score += cellsToClear.length * result.distinctSquares;
    this.applyGravity();
  }

  private detectSquares(): SquareMarkResult {
    const marked = new Set<string>();
    let distinctSquares = 0;

    for (let row = 0; row < ROWS - 1; row += 1) {
      for (let col = 0; col < COLS - 1; col += 1) {
        const color = this.settled[row]?.[col];
        if (
          color !== null &&
          this.settled[row]?.[col + 1] === color &&
          this.settled[row + 1]?.[col] === color &&
          this.settled[row + 1]?.[col + 1] === color
        ) {
          distinctSquares += 1;
          marked.add(keyFor(row, col));
          marked.add(keyFor(row, col + 1));
          marked.add(keyFor(row + 1, col));
          marked.add(keyFor(row + 1, col + 1));
        }
      }
    }

    return {
      distinctSquares,
      cells: [...marked].map((key) => {
        const [row, col] = key.split(":").map(Number) as [number, number];
        return { row, col };
      }),
    };
  }

  private applyGravity(): void {
    for (let col = 0; col < COLS; col += 1) {
      const filled: Color[] = [];
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        const cell = this.settled[row]?.[col];
        if (cell !== null && cell !== undefined) filled.push(cell);
      }

      for (let row = ROWS - 1; row >= 0; row -= 1) {
        this.settled[row]![col] = filled[ROWS - 1 - row] ?? null;
      }
    }
  }

  private lockActive(): void {
    if (!this.active) return;

    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const row = this.active.y + dy;
        const col = this.active.x + dx;
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
          this.settled[row]![col] = this.active.cells[dy]![dx]!;
        }
      }
    }

    this.active = null;
  }

  private canPlace(x: number, y: number, _cells: Piece): boolean {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const row = y + dy;
        const col = x + dx;
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
        if (this.settled[row]?.[col] !== null) return false;
      }
    }
    return true;
  }

  private gridWithActive(): Grid {
    const grid = cloneGrid(this.settled);
    if (!this.active) return grid;

    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const row = this.active.y + dy;
        const col = this.active.x + dx;
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
          grid[row]![col] = this.active.cells[dy]![dx]!;
        }
      }
    }

    return grid;
  }

  private randomPiece(): Piece {
    return [
      [this.randomColor(), this.randomColor()],
      [this.randomColor(), this.randomColor()],
    ];
  }

  private randomColor(): Color {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return (this.rngState & 1) as Color;
  }
}

export function clonePiece(piece: Piece): Piece {
  return [
    [piece[0][0], piece[0][1]],
    [piece[1][0], piece[1][1]],
  ];
}

export function rotatePiece(piece: Piece): Piece {
  return [
    [piece[1][0], piece[0][0]],
    [piece[1][1], piece[0][1]],
  ];
}
