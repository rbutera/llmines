import {
  GRID_COLS,
  GRID_ROWS,
  PIECE_SIZE,
  SPAWN_COL,
  SPAWN_ROW,
  SWEEP_MS,
} from "./constants";
import { SeededRng } from "./rng";
import type {
  ActivePiece,
  Cell,
  GameSnapshot,
  Grid,
  MarkedCell,
  Piece,
  SquareInfo,
} from "./types";

interface SweepState {
  deletedCells: Set<string>;
  squares: Set<string>;
  marked: Set<string>;
  squareCellsByColumn: Map<number, Set<string>>;
}

const cellKey = (row: number, col: number) => `${row}:${col}`;
const squareKey = (row: number, col: number) => `${row}:${col}`;

export const createEmptyGrid = (): Grid =>
  Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => null),
  );

export const cloneGrid = (grid: Grid): Grid => grid.map((row) => [...row]);

export const rotatePieceClockwise = (piece: Piece): Piece => [
  [piece[1][0], piece[0][0]],
  [piece[1][1], piece[0][1]],
];

export const detectSquares = (grid: Grid) => {
  const marked = new Map<string, MarkedCell>();
  const squares: SquareInfo[] = [];

  for (let row = 0; row <= GRID_ROWS - PIECE_SIZE; row++) {
    for (let col = 0; col <= GRID_COLS - PIECE_SIZE; col++) {
      const color = grid[row]?.[col];
      if (color === null || color === undefined) continue;

      const matches =
        grid[row]?.[col + 1] === color &&
        grid[row + 1]?.[col] === color &&
        grid[row + 1]?.[col + 1] === color;

      if (!matches) continue;

      const cells = [
        { row, col },
        { row, col: col + 1 },
        { row: row + 1, col },
        { row: row + 1, col: col + 1 },
      ];

      for (const cell of cells) {
        marked.set(cellKey(cell.row, cell.col), cell);
      }

      squares.push({ row, col, color, cells });
    }
  }

  return {
    marked: [...marked.values()].sort((a, b) => a.row - b.row || a.col - b.col),
    squares,
  };
};

const buildSweepState = (grid: Grid): SweepState => {
  const detected = detectSquares(grid);
  const marked = new Set(
    detected.marked.map((cell) => cellKey(cell.row, cell.col)),
  );
  const squareCellsByColumn = new Map<number, Set<string>>();

  for (const square of detected.squares) {
    const key = squareKey(square.row, square.col);
    for (const cell of square.cells) {
      const byColumn = squareCellsByColumn.get(cell.col) ?? new Set<string>();
      byColumn.add(key);
      squareCellsByColumn.set(cell.col, byColumn);
    }
  }

  return {
    deletedCells: new Set(),
    marked,
    squareCellsByColumn,
    squares: new Set(),
  };
};

export class GameEngine {
  private active: ActivePiece | null = null;
  private readonly autoSpawn: boolean;
  private grid = createEmptyGrid();
  private readonly rng = new SeededRng();
  private score = 0;
  private sweep: SweepState;
  private sweepX = 0;
  private over = false;

  constructor(options: { autoSpawn?: boolean } = {}) {
    this.autoSpawn = options.autoSpawn ?? true;
    this.sweep = buildSweepState(this.grid);

    if (this.autoSpawn) {
      this.spawnRandom();
    }
  }

  seed(seed: number) {
    this.rng.seed(seed);
  }

  snapshot(): GameSnapshot {
    const detected = detectSquares(this.grid);

    return {
      active: this.active ? this.cloneActive(this.active) : null,
      distinctSquares: detected.squares.length,
      gameOver: this.over,
      grid: this.combinedGrid(),
      marked: detected.marked,
      score: this.score,
      settled: cloneGrid(this.grid),
      sweepX: this.sweepX,
    };
  }

  state() {
    return {
      gameOver: this.over,
      grid: this.combinedGrid(),
      score: this.score,
      sweepX: this.sweepX,
    };
  }

  marked() {
    return detectSquares(this.grid).marked;
  }

  spawn(piece: Piece) {
    if (this.active) {
      this.lockActive(false);
    }

    this.over = false;
    const candidate = {
      col: SPAWN_COL,
      matrix: this.clonePiece(piece),
      row: SPAWN_ROW,
    };

    if (!this.canPlace(candidate)) {
      this.active = null;
      this.over = true;
      return;
    }

    this.active = candidate;
  }

  spawnRandom() {
    this.spawn(this.rng.piece());
  }

  move(dx: -1 | 1) {
    if (!this.active || this.over) return false;
    const candidate = { ...this.active, col: this.active.col + dx };
    if (!this.canPlace(candidate)) return false;
    this.active = candidate;
    return true;
  }

  rotate() {
    if (!this.active || this.over) return false;
    const candidate = {
      ...this.active,
      matrix: rotatePieceClockwise(this.active.matrix),
    };
    if (!this.canPlace(candidate)) return false;
    this.active = candidate;
    return true;
  }

  tick() {
    if (this.over) return;

    if (!this.active) {
      if (this.autoSpawn) this.spawnRandom();
      return;
    }

    const candidate = { ...this.active, row: this.active.row + 1 };
    if (this.canPlace(candidate)) {
      this.active = candidate;
      return;
    }

    this.lockActive(this.autoSpawn);
  }

  hardDrop() {
    if (!this.active || this.over) return;

    while (
      this.active &&
      this.canPlace({ ...this.active, row: this.active.row + 1 })
    ) {
      this.active = { ...this.active, row: this.active.row + 1 };
    }

    this.lockActive(this.autoSpawn);
  }

  sweepNow() {
    const sweep = buildSweepState(this.grid);
    this.clearSweepColumns(sweep, [...Array(GRID_COLS).keys()]);
    this.finishSweep(sweep);
    this.sweep = buildSweepState(this.grid);
    this.sweepX = 0;
  }

  sweepProgress(dtMs: number) {
    if (dtMs <= 0) return;

    let columnsToAdvance = (dtMs / SWEEP_MS) * GRID_COLS;

    while (columnsToAdvance > 0) {
      const currentColumn = Math.min(Math.floor(this.sweepX), GRID_COLS - 1);
      const distanceToNextColumn = currentColumn + 1 - this.sweepX;
      const step = Math.min(columnsToAdvance, distanceToNextColumn);

      this.sweepX += step;
      columnsToAdvance -= step;

      if (this.sweepX >= currentColumn + 1) {
        this.clearSweepColumns(this.sweep, [currentColumn]);
      }

      if (this.sweepX >= GRID_COLS) {
        this.finishSweep(this.sweep);
        this.sweepX = 0;
        this.sweep = buildSweepState(this.grid);
      }

      if (step === 0) break;
    }
  }

  private clearSweepColumns(sweep: SweepState, columns: number[]) {
    for (const col of columns) {
      let changed = false;

      for (let row = 0; row < GRID_ROWS; row++) {
        const key = cellKey(row, col);
        if (!sweep.marked.has(key) || this.grid[row]?.[col] === null) continue;

        this.grid[row]![col] = null;
        sweep.deletedCells.add(key);
        changed = true;
      }

      const squareKeys = sweep.squareCellsByColumn.get(col);
      if (squareKeys) {
        for (const key of squareKeys) sweep.squares.add(key);
      }

      if (changed) {
        this.applyColumnGravity(col);
      }
    }
  }

  private finishSweep(sweep: SweepState) {
    if (sweep.deletedCells.size > 0 && sweep.squares.size > 0) {
      this.score += sweep.deletedCells.size * sweep.squares.size;
    }
  }

  private lockActive(shouldAutoSpawn: boolean) {
    if (!this.active) return;

    for (let row = 0; row < PIECE_SIZE; row++) {
      for (let col = 0; col < PIECE_SIZE; col++) {
        const boardRow = this.active.row + row;
        const boardCol = this.active.col + col;
        this.grid[boardRow]![boardCol] = this.active.matrix[row]![col]!;
      }
    }

    this.active = null;

    if (shouldAutoSpawn) {
      this.spawnRandom();
    }
  }

  private applyColumnGravity(col: number) {
    const compacted: Cell[] = [];

    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      const value = this.grid[row]?.[col] ?? null;
      if (value !== null) compacted.push(value);
    }

    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      this.grid[row]![col] = compacted[GRID_ROWS - 1 - row] ?? null;
    }
  }

  private combinedGrid() {
    const combined = cloneGrid(this.grid);

    if (!this.active) return combined;

    for (let row = 0; row < PIECE_SIZE; row++) {
      for (let col = 0; col < PIECE_SIZE; col++) {
        const boardRow = this.active.row + row;
        const boardCol = this.active.col + col;
        if (this.inBounds(boardRow, boardCol)) {
          combined[boardRow]![boardCol] = this.active.matrix[row]![col]!;
        }
      }
    }

    return combined;
  }

  private canPlace(piece: ActivePiece) {
    for (let row = 0; row < PIECE_SIZE; row++) {
      for (let col = 0; col < PIECE_SIZE; col++) {
        const boardRow = piece.row + row;
        const boardCol = piece.col + col;

        if (!this.inBounds(boardRow, boardCol)) return false;
        if (this.grid[boardRow]?.[boardCol] !== null) return false;
      }
    }

    return true;
  }

  private inBounds(row: number, col: number) {
    return row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS;
  }

  private cloneActive(piece: ActivePiece): ActivePiece {
    return {
      col: piece.col,
      matrix: this.clonePiece(piece.matrix),
      row: piece.row,
    };
  }

  private clonePiece(piece: Piece): Piece {
    return [
      [piece[0][0], piece[0][1]],
      [piece[1][0], piece[1][1]],
    ];
  }
}
