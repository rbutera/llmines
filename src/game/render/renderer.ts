import { Application, Container, Graphics } from "pixi.js";
import { BOARD_ASPECT, COLS, ROWS, type Cell, type Grid } from "../core";
import type { GameController, RenderState } from "../engine/controller";
import {
  burstParticleCount,
  scoreIntensity,
  shouldBurstOnClear,
} from "../fx/scoreFx";

const CELL = 40;
const BOARD_W = COLS * CELL; // 640
const BOARD_H = ROWS * CELL; // 400

const BG = 0x0b0e1a;
const GRID_LINE = 0x1b2138;
const COLOR_A = 0x37e0c9; // cyan
const COLOR_A_HI = 0x9bf6e8;
const COLOR_B = 0xff5fb0; // magenta
const COLOR_B_HI = 0xffc1e3;
const SWEEP = 0xfff2a8;

function colorOf(c: Cell): { base: number; hi: number } {
  return c === 0
    ? { base: COLOR_A, hi: COLOR_A_HI }
    : { base: COLOR_B, hi: COLOR_B_HI };
}

interface Flash {
  x: number;
  y: number;
  color: number;
  life: number; // 0..1, 1 = fresh
  /** Velocity (px/ms) for score-burst sparks; absent => static cell flash. */
  vx?: number;
  vy?: number;
  /** Draw as a small drifting spark (score burst) rather than a cell flash. */
  spark?: boolean;
  /** Per-particle fade rate (1/ms); sparks live a little longer than flashes. */
  decay?: number;
}

/** Count of non-null (occupied) cells in the settled grid. */
function occupiedCount(grid: Grid): number {
  let n = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((grid[row]![col] ?? null) !== null) n++;
    }
  }
  return n;
}

/**
 * Number of settled cells removed between two frames. Settle never changes the
 * occupied count and a lock only ADDS cells, so a net drop in occupied cells is
 * exactly a square-clear (sweep deletion / chain flood) this frame. Pure;
 * exported so the burst-gating decision is unit-testable without Pixi.
 */
export function clearedCellCount(prevGrid: Grid, newGrid: Grid): number {
  return Math.max(0, occupiedCount(prevGrid) - occupiedCount(newGrid));
}

/** Per-column occupied rows, bottom-to-top, with colours. */
function columnStack(grid: Grid, col: number): { row: number; cell: Cell }[] {
  const out: { row: number; cell: Cell }[] = [];
  for (let row = ROWS - 1; row >= 0; row--) {
    const c = grid[row]![col] ?? null;
    if (c !== null) out.push({ row, cell: c });
  }
  return out;
}

/**
 * Pure collapse diff: match each column's new stack to its old stack (top-down,
 * pairing each surviving cell to the next old cell of the SAME colour — the new
 * stack is a colour-ordered subsequence of the old one) and, for any cell that
 * ended LOWER than it started, return a
 * starting pixel offset (negative = above its rest position) so the renderer can
 * ease it down. This is what animates an incremental per-column settle: the bar
 * clearing a column emits a new RenderState whose column lost cells, so the
 * stack above falls and is tweened here — no special-casing needed for the
 * deferred-gravity fix. Keyed by `row * COLS + col`. Exported for testing.
 */
export function computeCollapseOffsets(
  oldGrid: Grid,
  newGrid: Grid,
  cell = CELL,
): Map<number, number> {
  const offsets = new Map<number, number>();
  for (let col = 0; col < COLS; col++) {
    // Settle preserves the colour ORDER of surviving cells within a column, so
    // the new stack is a subsequence of the old one. Match them top-down, pairing
    // each new cell to the next old cell of the SAME colour. This correctly
    // animates an incremental settle where cells were cleared from BELOW the
    // survivors (the deferred-gravity fix's frame): the survivors fell by the
    // number of cleared cells beneath them. A bottom-up index match would miss
    // this because the bottom rows stay occupied across the frame.
    const oldStack = columnStack(oldGrid, col).reverse(); // now top-down
    const newStack = columnStack(newGrid, col).reverse(); // now top-down
    let oi = 0;
    for (const nu of newStack) {
      while (oi < oldStack.length && oldStack[oi]!.cell !== nu.cell) oi++;
      if (oi >= oldStack.length) break; // no further match (defensive)
      const oldRow = oldStack[oi]!.row;
      oi++;
      if (nu.row > oldRow) {
        offsets.set(nu.row * COLS + col, (oldRow - nu.row) * cell);
      }
    }
  }
  return offsets;
}

/**
 * Immediate-mode Pixi renderer. Redraws each frame from the latest RenderState
 * plus a small animation model:
 *  - active piece descends smoothly via fallProgress
 *  - settled cells animate a collapse (per-column identity match) after clears
 *  - marked cells pulse; the sweep bar glides with a glow + trail
 *  - cleared cells emit a brief flash as the bar passes
 */
export class PixiRenderer {
  private app: Application | null = null;
  private cellG = new Graphics();
  private pieceG = new Graphics();
  private markG = new Graphics();
  private sweepG = new Graphics();
  private fxG = new Graphics();

  private last: RenderState | null = null;
  private prevGrid: Grid | null = null;
  private prevMarked = new Set<number>();
  private fallOffsets = new Map<number, number>(); // key row*COLS+col -> px offset
  private flashes: Flash[] = [];
  private prevScore = 0; // last score seen; a rise fires a burst
  private scoreFlash = 0; // 0..1 full-field flash alpha on a score gain
  private clock = 0;
  private unsub: (() => void) | null = null;
  private destroyed = false;

  async init(parent: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      width: BOARD_W,
      height: BOARD_H,
      background: BG,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(
        2,
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      ),
    });
    // Guard against StrictMode double-invoke / unmount during async init.
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    parent.appendChild(app.canvas);
    app.canvas.style.display = "block";
    // Render-scale fit (display-only): fill the container's width and derive the
    // height from the logical aspect ratio. The logical grid (COLS x ROWS) and
    // all cell coordinates in state() are unchanged — this is pure CSS scaling.
    // Previously the canvas was capped at its native BOARD_W (640px), which made
    // the board feel small on wider containers; scaling to 100% fixes that.
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.style.aspectRatio = BOARD_ASPECT;
    app.canvas.setAttribute("aria-hidden", "true");

    const stage = new Container();
    stage.addChild(this.buildGrid());
    stage.addChild(this.cellG, this.markG, this.pieceG, this.fxG, this.sweepG);
    app.stage.addChild(stage);

    app.ticker.add((t) => this.frame(t.deltaMS));
  }

  attach(controller: GameController): void {
    this.unsub = controller.subscribe((rs) => this.onState(rs));
  }

  destroy(): void {
    this.destroyed = true;
    this.unsub?.();
    this.unsub = null;
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  // ---- state intake --------------------------------------------------------

  private onState(rs: RenderState): void {
    const markedSet = new Set(rs.marked.map((m) => m.row * COLS + m.col));

    // Cells that vanished from the settled stack this frame. Settle never
    // changes the occupied count and a lock only ADDS cells, so a net drop in
    // occupied cells is precisely a square-clear (sweep deletion / chain flood)
    // — the one event the center burst is reserved for.
    const clearedCells = this.prevGrid
      ? clearedCellCount(this.prevGrid, rs.grid)
      : 0;

    if (this.prevGrid) {
      this.seedCollapse(this.prevGrid, rs.grid);
      this.seedClearFlashes(this.prevGrid, rs.grid);
    }
    // The center score-gain burst fires ONLY on an actual square clear, not on
    // soft-drop/settle score changes (those bank points without removing cells).
    // It is still scaled by the score delta so a bigger clear bursts bigger.
    if (shouldBurstOnClear(clearedCells) && rs.score > this.prevScore) {
      this.seedScoreBurst(rs.score - this.prevScore);
    }
    this.prevScore = rs.score;
    this.prevGrid = rs.grid.map((r) => r.slice());
    this.prevMarked = markedSet;
    this.last = rs;
  }

  /**
   * Spawn a score-gain burst in the play area: a brief full-field flash plus a
   * radial spray of sparks from the centre, both scaled by the score delta. The
   * spark count is capped (see burstParticleCount) so a huge clear can't tank
   * the frame; sparks reuse the existing flash list + draw loop.
   */
  private seedScoreBurst(delta: number): void {
    const intensity = scoreIntensity(delta);
    this.scoreFlash = Math.min(1, this.scoreFlash + 0.2 + intensity * 0.55);
    const n = burstParticleCount(delta);
    const cx = BOARD_W / 2;
    const cy = BOARD_H / 2;
    for (let i = 0; i < n; i++) {
      // Deterministic-ish radial spread (no Math.random dependency on order):
      const angle = (i / n) * Math.PI * 2 + i * 0.618;
      const speed = 0.06 + intensity * 0.18 + (i % 5) * 0.01;
      this.flashes.push({
        x: cx,
        y: cy,
        color: i % 3 === 0 ? 0xffffff : SWEEP,
        life: 1,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spark: true,
        decay: 1 / (520 + intensity * 380),
      });
    }
  }

  /** Match each column's new stack to its old stack to animate fallen cells. */
  private seedCollapse(oldGrid: Grid, newGrid: Grid): void {
    for (const [key, off] of computeCollapseOffsets(oldGrid, newGrid)) {
      this.fallOffsets.set(key, off);
    }
  }

  /** Emit a flash wherever a previously-marked cell just disappeared. */
  private seedClearFlashes(oldGrid: Grid, newGrid: Grid): void {
    for (const idx of this.prevMarked) {
      const row = Math.floor(idx / COLS);
      const col = idx % COLS;
      const was = oldGrid[row]![col] ?? null;
      if (was !== null && (newGrid[row]![col] ?? null) === null) {
        this.flashes.push({
          x: col * CELL,
          y: row * CELL,
          color: colorOf(was).hi,
          life: 1,
        });
      }
    }
  }

  // ---- per-frame draw ------------------------------------------------------

  private frame(dtMs: number): void {
    if (!this.app || !this.last) return;
    this.clock += dtMs;

    // ease fall offsets toward 0
    const ease = Math.min(1, dtMs / 90);
    for (const [key, off] of this.fallOffsets) {
      const next = off * (1 - ease);
      if (Math.abs(next) < 0.5) this.fallOffsets.delete(key);
      else this.fallOffsets.set(key, next);
    }
    // age flashes; drift score-burst sparks along their velocity
    this.flashes = this.flashes.filter((f) => {
      f.life -= dtMs * (f.decay ?? 1 / 260);
      if (f.spark) {
        f.x += (f.vx ?? 0) * dtMs;
        f.y += (f.vy ?? 0) * dtMs;
      }
      return f.life > 0;
    });
    // decay the full-field score flash
    if (this.scoreFlash > 0) {
      this.scoreFlash = Math.max(0, this.scoreFlash - dtMs / 220);
    }

    this.drawCells(this.last);
    this.drawMarked(this.last);
    this.drawPiece(this.last);
    this.drawFlashes();
    this.drawSweep(this.last);
  }

  private buildGrid(): Graphics {
    const g = new Graphics();
    g.rect(0, 0, BOARD_W, BOARD_H).fill({ color: 0x070912 });
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(c * CELL, 0).lineTo(c * CELL, BOARD_H);
    }
    for (let r = 0; r <= ROWS; r++) {
      g.moveTo(0, r * CELL).lineTo(BOARD_W, r * CELL);
    }
    g.stroke({ width: 1, color: GRID_LINE, alpha: 0.8 });
    return g;
  }

  private cellRect(
    g: Graphics,
    col: number,
    row: number,
    yOff: number,
    color: Cell,
    opts: { glow?: number } = {},
  ): void {
    const x = col * CELL;
    const y = row * CELL + yOff;
    const { base, hi } = colorOf(color);
    const pad = 2;
    if (opts.glow) {
      g.roundRect(x - 1, y - 1, CELL + 2, CELL + 2, 9).fill({
        color: hi,
        alpha: opts.glow,
      });
    }
    g.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7).fill(base);
    // top sheen
    g.roundRect(x + pad + 3, y + pad + 3, CELL - pad * 2 - 6, 6, 4).fill({
      color: hi,
      alpha: 0.55,
    });
  }

  private drawCells(rs: RenderState): void {
    const g = this.cellG;
    g.clear();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = rs.grid[row]![col] ?? null;
        if (cell === null) continue;
        const yOff = this.fallOffsets.get(row * COLS + col) ?? 0;
        this.cellRect(g, col, row, yOff, cell);
      }
    }
  }

  private drawMarked(rs: RenderState): void {
    const g = this.markG;
    g.clear();
    const pulse = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock / 160));
    for (const { row, col } of rs.marked) {
      const x = col * CELL;
      const y = row * CELL + (this.fallOffsets.get(row * COLS + col) ?? 0);
      g.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 7).stroke({
        width: 2.5,
        color: 0xffffff,
        alpha: pulse,
      });
      g.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 5).fill({
        color: 0xffffff,
        alpha: pulse * 0.25,
      });
    }
  }

  private drawPiece(rs: RenderState): void {
    const g = this.pieceG;
    g.clear();
    if (!rs.active) return;
    const { cells, pos } = rs.active;
    // Unified dip clamp: the active piece's lowest cells sit at `pos.row + 1`, so
    // the smooth-fall offset must never push a cell past where it will actually
    // come to rest. ONE consistent "where does this cell come to rest" rule
    // covers BOTH cases:
    //   - bottom-of-grid: the floor row (ROWS - 1), and
    //   - stacking-onto-other-blocks: the row just above the highest settled cell
    //     beneath the piece's columns.
    // For each of the piece's two columns we find the first occupied settled row
    // at/under the lowest piece row; the rest surface is whichever column rests
    // higher (so neither column ever visually overlaps the stack below it before
    // the lock snaps). This kills the stack-on-blocks dip the same way the
    // floor case was already fixed.
    const lowestPieceRow = pos.row + 1;
    const restRoomForColumn = (col: number): number => {
      if (col < 0 || col >= COLS) return 0;
      for (let row = lowestPieceRow + 1; row < ROWS; row++) {
        if (rs.grid[row]?.[col] != null) return row - 1 - lowestPieceRow;
      }
      return ROWS - 1 - lowestPieceRow;
    };
    const roomBelow = Math.max(
      0,
      Math.min(restRoomForColumn(pos.col), restRoomForColumn(pos.col + 1)),
    );
    const yOff = Math.min(rs.fallProgress, roomBelow) * CELL;
    // "Ready to place" cue: while the new block is held it pulses a brighter
    // glow (and an outline ring) so the hold reads as an intentional beat. The
    // piece does not move (fallProgress is 0 while held), so it never drifts.
    const held = rs.hold.active;
    const glow = held ? 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock / 130)) : 0.4;
    const map: [number, number, Cell][] = [
      [pos.row, pos.col, cells[0][0]],
      [pos.row, pos.col + 1, cells[0][1]],
      [pos.row + 1, pos.col, cells[1][0]],
      [pos.row + 1, pos.col + 1, cells[1][1]],
    ];
    for (const [row, col, color] of map) {
      this.cellRect(g, col, row, yOff, color, { glow });
    }
    if (held) {
      const x = pos.col * CELL;
      const y = pos.row * CELL + yOff;
      const ring = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock / 130));
      g.roundRect(x + 1, y + 1, CELL * 2 - 2, CELL * 2 - 2, 10).stroke({
        width: 2,
        color: 0xffffff,
        alpha: ring,
      });
    }
  }

  private drawFlashes(): void {
    const g = this.fxG;
    g.clear();
    // Full-field flash on a score gain (drawn under the sparks).
    if (this.scoreFlash > 0) {
      g.rect(0, 0, BOARD_W, BOARD_H).fill({
        color: SWEEP,
        alpha: this.scoreFlash * 0.22,
      });
    }
    for (const f of this.flashes) {
      if (f.spark) {
        // Score-burst spark: a small bright dot with a soft halo, shrinking out.
        const r = 2 + f.life * 4;
        g.circle(f.x, f.y, r * 2).fill({ color: f.color, alpha: f.life * 0.25 });
        g.circle(f.x, f.y, r).fill({ color: f.color, alpha: f.life * 0.9 });
        continue;
      }
      const grow = (1 - f.life) * 10;
      g.roundRect(
        f.x - grow,
        f.y - grow,
        CELL + grow * 2,
        CELL + grow * 2,
        8,
      ).fill({ color: f.color, alpha: f.life * 0.8 });
    }
  }

  private drawSweep(rs: RenderState): void {
    const g = this.sweepG;
    g.clear();
    const x = rs.sweepX * CELL;
    // trail
    const trailW = CELL * 2.2;
    for (let i = 0; i < 6; i++) {
      const a = 0.06 * (1 - i / 6);
      g.rect(x - trailW + (i * trailW) / 6, 0, trailW / 6, BOARD_H).fill({
        color: SWEEP,
        alpha: a,
      });
    }
    // glow + core bar
    g.rect(x - 6, 0, 12, BOARD_H).fill({ color: SWEEP, alpha: 0.18 });
    g.rect(x - 1.5, 0, 3, BOARD_H).fill({ color: 0xffffff, alpha: 0.95 });
    g.circle(x, 6, 5).fill({ color: 0xffffff });
    g.circle(x, BOARD_H - 6, 5).fill({ color: 0xffffff });
  }
}
