"use client";

import { Application, Graphics } from "pixi.js";
import { useEffect, useRef, useState } from "react";

import { GRID_COLS, GRID_ROWS } from "~/game/constants";
import type { ActivePiece, GameSnapshot } from "~/game/types";

const CELL = 34;
const GAP = 3;
const PAD = 16;
const BOARD_W = PAD * 2 + GRID_COLS * CELL;
const BOARD_H = PAD * 2 + GRID_ROWS * CELL;
const COLORS = [0x21d6ff, 0xffd23f] as const;

const markedKey = (row: number, col: number) => `${row}:${col}`;

interface PixiBoardProps {
  snapshot: GameSnapshot;
}

export function PixiBoard({ snapshot }: PixiBoardProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const graphicsRef = useRef<Graphics | null>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    const app = new Application();

    void app
      .init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        height: BOARD_H,
        resolution: window.devicePixelRatio || 1,
        width: BOARD_W,
      })
      .then(() => {
        if (disposed) {
          app.destroy();
          return;
        }

        const graphics = new Graphics();
        app.stage.addChild(graphics);
        app.canvas.setAttribute("aria-label", "LLMines playfield");
        app.canvas.style.display = "block";
        app.canvas.style.height = "100%";
        app.canvas.style.width = "100%";
        mount.replaceChildren(app.canvas);
        appRef.current = app;
        graphicsRef.current = graphics;
        setReady((value) => value + 1);
      });

    return () => {
      disposed = true;
      graphicsRef.current?.destroy();
      graphicsRef.current = null;
      appRef.current?.destroy();
      appRef.current = null;
      mount.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const graphics = graphicsRef.current;
    if (!graphics) return;
    drawBoard(graphics, snapshot);
  }, [ready, snapshot]);

  return (
    <div className="relative aspect-[576/372] w-full max-w-[720px] rounded-lg border border-white/15 bg-[#08141d] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div ref={mountRef} className="h-full w-full" />
    </div>
  );
}

const drawBoard = (graphics: Graphics, snapshot: GameSnapshot) => {
  graphics.clear();

  const phase = (performance.now() % 900) / 900;
  const marked = new Set(
    snapshot.marked.map((cell) => markedKey(cell.row, cell.col)),
  );

  graphics.roundRect(0, 0, BOARD_W, BOARD_H, 14).fill({ color: 0x061018 });
  graphics
    .roundRect(
      PAD - 8,
      PAD - 8,
      GRID_COLS * CELL + 16,
      GRID_ROWS * CELL + 16,
      10,
    )
    .stroke({ alpha: 0.6, color: 0x65ffe0, width: 2 });

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = PAD + col * CELL;
      const y = PAD + row * CELL;

      graphics
        .roundRect(x + GAP, y + GAP, CELL - GAP * 2, CELL - GAP * 2, 5)
        .fill({ alpha: 0.35, color: 0x102635 });
      graphics
        .roundRect(x + GAP, y + GAP, CELL - GAP * 2, CELL - GAP * 2, 5)
        .stroke({ alpha: 0.16, color: 0xffffff, width: 1 });
    }
  }

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = snapshot.settled[row]?.[col];
      if (cell === null || cell === undefined) continue;
      drawCell(
        graphics,
        row,
        col,
        COLORS[cell],
        marked.has(markedKey(row, col)),
        phase,
        0.92,
      );
    }
  }

  if (snapshot.active) {
    drawActivePiece(graphics, snapshot.active, phase);
  }

  const sweepX = PAD + snapshot.sweepX * CELL;
  graphics.rect(sweepX - 3, PAD - 10, 6, GRID_ROWS * CELL + 20).fill({
    alpha: 0.95,
    color: 0xffffff,
  });
  graphics.rect(sweepX - 18, PAD - 8, 28, GRID_ROWS * CELL + 16).fill({
    alpha: 0.15,
    color: 0x88ffec,
  });
};

const drawActivePiece = (
  graphics: Graphics,
  active: ActivePiece,
  phase: number,
) => {
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const boardRow = active.row + row;
      const boardCol = active.col + col;
      const color = active.matrix[row]?.[col];
      if (color === undefined) continue;
      drawCell(graphics, boardRow, boardCol, COLORS[color], false, phase, 1);
    }
  }
};

const drawCell = (
  graphics: Graphics,
  row: number,
  col: number,
  color: number,
  marked: boolean,
  phase: number,
  alpha: number,
) => {
  const pulse = marked ? 1 + Math.sin(phase * Math.PI * 2) * 0.08 : 1;
  const inset = marked ? 1 : 4;
  const x = PAD + col * CELL + inset;
  const y = PAD + row * CELL + inset;
  const size = CELL - inset * 2;

  if (marked) {
    graphics.roundRect(x - 3, y - 3, size + 6, size + 6, 7).fill({
      alpha: 0.25 + phase * 0.18,
      color: 0xffffff,
    });
  }

  graphics.roundRect(x, y, size, size, 6).fill({ alpha, color });
  graphics
    .roundRect(x + 4, y + 4, size - 8, Math.max(5, size * 0.28 * pulse), 4)
    .fill({
      alpha: 0.28,
      color: 0xffffff,
    });
  graphics.roundRect(x, y, size, size, 6).stroke({
    alpha: marked ? 0.9 : 0.38,
    color: marked ? 0xffffff : 0x061018,
    width: marked ? 3 : 2,
  });
};
