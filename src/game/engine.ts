import type {
  ActivePiece,
  Cell,
  Color,
  Grid,
  LuminesSnapshot,
  LuminesState,
  MarkedCell,
  MoveCommand,
  Piece,
  SquareMark,
} from "./types";

export const COLS = 16;
export const ROWS = 10;
export const SPAWN_X = 7;
export const SPAWN_Y = 0;
export const SWEEP_PERIOD_MS = 4_000;
export const SWEEP_MS_PER_COL = SWEEP_PERIOD_MS / COLS;
export const GRAVITY_TICK_MS = 650;

const PIECE_SIZE = 2;

interface EngineOptions {
  autoSpawn: boolean;
}

type Rng = () => number;

function clonePiece(piece: Piece): Piece {
  return [
    [piece[0][0], piece[0][1]],
    [piece[1][0], piece[1][1]],
  ];
}

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function makeRng(seed: number): Rng {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

function normalizePiece(piece: Piece): Piece {
  return [
    [piece[0][0] === 0 ? 0 : 1, piece[0][1] === 0 ? 0 : 1],
    [piece[1][0] === 0 ? 0 : 1, piece[1][1] === 0 ? 0 : 1],
  ];
}

function rotatePieceClockwise(piece: Piece): Piece {
  return [
    [piece[1][0], piece[0][0]],
    [piece[1][1], piece[0][1]],
  ];
}

export class LuminesEngine {
  private readonly autoSpawn: boolean;
  private grid: Grid = emptyGrid();
  private active: ActivePiece | null = null;
  private rng: Rng = makeRng(1);
  private score = 0;
  private gameOver = false;
  private sweepMs = 0;
  private sweepX = 0;

  constructor(options: EngineOptions) {
    this.autoSpawn = options.autoSpawn;
  }

  reset(spawnInitial: boolean): void {
    this.grid = emptyGrid();
    this.active = null;
    this.score = 0;
    this.gameOver = false;
    this.sweepMs = 0;
    this.sweepX = 0;

    if (spawnInitial) {
      this.spawnRandom();
    }
  }

  seed(seed: number): void {
    this.rng = makeRng(seed);
  }

  state(): LuminesState {
    return {
      grid: this.composedGrid(),
      score: this.score,
      gameOver: this.gameOver,
      sweepX: this.sweepX,
    };
  }

  snapshot(): LuminesSnapshot {
    return {
      ...this.state(),
      settled: cloneGrid(this.grid),
      active: this.active
        ? {
            piece: clonePiece(this.active.piece),
            x: this.active.x,
            y: this.active.y,
          }
        : null,
      marked: this.marked(),
    };
  }

  marked(): MarkedCell[] {
    return this.squareMarks().flatMap((square) => square.cells).filter(
      (cell, index, cells) =>
        cells.findIndex(
          (candidate) => candidate.row === cell.row && candidate.col === cell.col,
        ) === index,
    );
  }

  spawn(piece: Piece): void {
    if (this.active) {
      this.lockActive(false);
    }
    this.placePiece(normalizePiece(piece));
  }

  spawnRandom(): void {
    this.placePiece(this.randomPiece());
  }

  command(command: MoveCommand): void {
    if (this.gameOver || !this.active) {
      return;
    }

    if (command === "left") {
      this.tryMove(-1, 0);
      return;
    }
    if (command === "right") {
      this.tryMove(1, 0);
      return;
    }
    if (command === "softDrop") {
      this.tick();
      return;
    }
    if (command === "rotate") {
      this.tryRotate();
      return;
    }
    this.hardDrop();
  }

  tick(): void {
    if (this.gameOver || !this.active) {
      return;
    }

    if (this.canPlace(this.active.piece, this.active.x, this.active.y + 1)) {
      this.active = { ...this.active, y: this.active.y + 1 };
      return;
    }

    this.lockActive(this.autoSpawn);
  }

  hardDrop(): void {
    if (this.gameOver || !this.active) {
      return;
    }

    let targetY = this.active.y;
    while (this.canPlace(this.active.piece, this.active.x, targetY + 1)) {
      targetY += 1;
    }
    this.active = { ...this.active, y: targetY };
    this.lockActive(this.autoSpawn);
  }

  sweepNow(): void {
    const squares = this.squareMarks();
    const cells = this.uniqueCells(squares.flatMap((square) => square.cells));

    if (cells.length === 0 || squares.length === 0) {
      this.sweepMs = 0;
      this.sweepX = 0;
      return;
    }

    for (const cell of cells) {
      const row = this.grid[cell.row];
      if (row) {
        row[cell.col] = null;
      }
    }

    this.score += cells.length * squares.length;
    this.applyGravity([...new Set(cells.map((cell) => cell.col))]);
    this.sweepMs = 0;
    this.sweepX = 0;
  }

  sweepProgress(dtMs: number): void {
    if (dtMs <= 0) {
      return;
    }

    const previousX = this.sweepX;
    this.sweepMs = (this.sweepMs + dtMs) % SWEEP_PERIOD_MS;
    this.sweepX = this.sweepMs / SWEEP_MS_PER_COL;

    if (dtMs >= SWEEP_PERIOD_MS) {
      this.sweepNow();
      return;
    }

    const passedColumns = this.passedColumns(previousX, this.sweepX);
    if (passedColumns.length > 0) {
      this.clearColumns(passedColumns);
    }
  }

  private randomPiece(): Piece {
    const color = (): Color => (this.rng() < 0.5 ? 0 : 1);
    return [
      [color(), color()],
      [color(), color()],
    ];
  }

  private placePiece(piece: Piece): void {
    if (!this.canPlace(piece, SPAWN_X, SPAWN_Y)) {
      this.active = null;
      this.gameOver = true;
      return;
    }

    this.active = {
      piece: clonePiece(piece),
      x: SPAWN_X,
      y: SPAWN_Y,
    };
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.active) {
      return false;
    }

    const nextX = this.active.x + dx;
    const nextY = this.active.y + dy;
    if (!this.canPlace(this.active.piece, nextX, nextY)) {
      return false;
    }

    this.active = { ...this.active, x: nextX, y: nextY };
    return true;
  }

  private tryRotate(): void {
    if (!this.active) {
      return;
    }

    const rotated = rotatePieceClockwise(this.active.piece);
    if (this.canPlace(rotated, this.active.x, this.active.y)) {
      this.active = { ...this.active, piece: rotated };
    }
  }

  private lockActive(spawnNext: boolean): void {
    if (!this.active) {
      return;
    }

    for (let row = 0; row < PIECE_SIZE; row += 1) {
      for (let col = 0; col < PIECE_SIZE; col += 1) {
        const gridRow = this.active.y + row;
        const gridCol = this.active.x + col;
        const rowCells = this.grid[gridRow];
        if (rowCells && gridCol >= 0 && gridCol < COLS) {
          rowCells[gridCol] = this.active.piece[row]?.[col] ?? null;
        }
      }
    }

    this.active = null;

    if (spawnNext && !this.gameOver) {
      this.spawnRandom();
    }
  }

  private canPlace(piece: Piece, x: number, y: number): boolean {
    for (let row = 0; row < PIECE_SIZE; row += 1) {
      for (let col = 0; col < PIECE_SIZE; col += 1) {
        const gridRow = y + row;
        const gridCol = x + col;
        if (gridCol < 0 || gridCol >= COLS || gridRow < 0 || gridRow >= ROWS) {
          return false;
        }
        if (this.grid[gridRow]?.[gridCol] !== null) {
          return false;
        }
      }
    }
    return true;
  }

  private composedGrid(): Grid {
    const composed = cloneGrid(this.grid);
    if (!this.active) {
      return composed;
    }

    for (let row = 0; row < PIECE_SIZE; row += 1) {
      for (let col = 0; col < PIECE_SIZE; col += 1) {
        const gridRow = this.active.y + row;
        const gridCol = this.active.x + col;
        if (gridRow >= 0 && gridRow < ROWS && gridCol >= 0 && gridCol < COLS) {
          const rowCells = composed[gridRow];
          if (rowCells) {
            rowCells[gridCol] = this.active.piece[row]?.[col] ?? null;
          }
        }
      }
    }

    return composed;
  }

  private squareMarks(): SquareMark[] {
    const squares: SquareMark[] = [];
    for (let row = 0; row < ROWS - 1; row += 1) {
      for (let col = 0; col < COLS - 1; col += 1) {
        const color = this.grid[row]?.[col];
        if (color === null || color === undefined) {
          continue;
        }

        if (
          this.grid[row]?.[col + 1] === color &&
          this.grid[row + 1]?.[col] === color &&
          this.grid[row + 1]?.[col + 1] === color
        ) {
          squares.push({
            row,
            col,
            color,
            cells: [
              { row, col },
              { row, col: col + 1 },
              { row: row + 1, col },
              { row: row + 1, col: col + 1 },
            ],
          });
        }
      }
    }
    return squares;
  }

  private uniqueCells(cells: MarkedCell[]): MarkedCell[] {
    const seen = new Set<string>();
    const unique: MarkedCell[] = [];

    for (const cell of cells) {
      const key = cellKey(cell.row, cell.col);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(cell);
      }
    }

    return unique;
  }

  private clearColumns(columns: number[]): void {
    const columnSet = new Set(columns);
    const squares = this.squareMarks();
    const deleted = this.uniqueCells(
      squares
        .flatMap((square) => square.cells)
        .filter((cell) => columnSet.has(cell.col)),
    );

    if (deleted.length === 0) {
      return;
    }

    const squareCount = squares.filter((square) =>
      square.cells.some((cell) => columnSet.has(cell.col)),
    ).length;

    for (const cell of deleted) {
      const row = this.grid[cell.row];
      if (row) {
        row[cell.col] = null;
      }
    }

    this.score += deleted.length * squareCount;
    this.applyGravity(columns);
  }

  private passedColumns(previousX: number, nextX: number): number[] {
    const columns: number[] = [];
    if (nextX === previousX) {
      return columns;
    }

    if (nextX > previousX) {
      for (let col = Math.floor(previousX); col < Math.floor(nextX); col += 1) {
        if (col >= 0 && col < COLS) {
          columns.push(col);
        }
      }
      return columns;
    }

    for (let col = Math.floor(previousX); col < COLS; col += 1) {
      columns.push(col);
    }
    for (let col = 0; col < Math.floor(nextX); col += 1) {
      columns.push(col);
    }
    return columns;
  }

  private applyGravity(columns: number[]): void {
    for (const col of columns) {
      const cells: Color[] = [];
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        const cell = this.grid[row]?.[col];
        if (cell !== null && cell !== undefined) {
          cells.push(cell);
        }
      }

      for (let row = ROWS - 1; row >= 0; row -= 1) {
        const rowCells = this.grid[row];
        if (rowCells) {
          rowCells[col] = cells[ROWS - 1 - row] ?? null;
        }
      }
    }
  }
}
