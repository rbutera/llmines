"use client";

import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";

import { COLS, ROWS } from "~/game/engine";
import type { LuminesSnapshot } from "~/game/types";

interface LLMinesPixiProps {
  snapshot: LuminesSnapshot;
}

const BOARD_WIDTH = 704;
const BOARD_HEIGHT = 440;
const PADDING = 20;
const CELL_SIZE = Math.min(
  (BOARD_WIDTH - PADDING * 2) / COLS,
  (BOARD_HEIGHT - PADDING * 2) / ROWS,
);
const GRID_WIDTH = CELL_SIZE * COLS;
const GRID_HEIGHT = CELL_SIZE * ROWS;
const OFFSET_X = (BOARD_WIDTH - GRID_WIDTH) / 2;
const OFFSET_Y = (BOARD_HEIGHT - GRID_HEIGHT) / 2;

const CELL_COLORS = {
  0: 0x00d7ff,
  1: 0xffd84a,
} as const;

function markedKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function LLMinesPixi({ snapshot }: LLMinesPixiProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    let app: Application | null = null;
    let graphics: Graphics | null = null;

    const draw = (time: number) => {
      if (!graphics) {
        return;
      }

      const current = snapshotRef.current;
      const pulse = (Math.sin(time / 150) + 1) / 2;
      const marked = new Set(current.marked.map((cell) => markedKey(cell.row, cell.col)));

      graphics.clear();
      graphics.roundRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, 8).fill(0x101827);
      graphics.roundRect(OFFSET_X - 8, OFFSET_Y - 8, GRID_WIDTH + 16, GRID_HEIGHT + 16, 8).fill(
        0x192235,
      );

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const x = OFFSET_X + col * CELL_SIZE;
          const y = OFFSET_Y + row * CELL_SIZE;
          const cell = current.grid[row]?.[col] ?? null;
          const isMarked = marked.has(markedKey(row, col));

          graphics
            .roundRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4, 5)
            .fill(cell === null ? 0x273043 : CELL_COLORS[cell]);
          graphics
            .roundRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4, 5)
            .stroke({ color: 0x4b607f, width: 1, alpha: cell === null ? 0.34 : 0.72 });

          if (cell !== null) {
            graphics
              .roundRect(x + 7, y + 7, CELL_SIZE - 14, CELL_SIZE - 14, 4)
              .fill({ color: 0xffffff, alpha: 0.12 });
          }

          if (isMarked) {
            graphics
              .roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, 6)
              .stroke({ color: 0xffffff, width: 3, alpha: 0.55 + pulse * 0.45 });
            graphics
              .roundRect(x + 5, y + 5, CELL_SIZE - 10, CELL_SIZE - 10, 5)
              .fill({ color: 0xffffff, alpha: 0.08 + pulse * 0.12 });
          }
        }
      }

      const sweepX = OFFSET_X + current.sweepX * CELL_SIZE;
      graphics
        .rect(sweepX - 5, OFFSET_Y - 10, 10, GRID_HEIGHT + 20)
        .fill({ color: 0xffffff, alpha: 0.3 });
      graphics.rect(sweepX - 1.5, OFFSET_Y - 14, 3, GRID_HEIGHT + 28).fill(0xffffff);
      graphics
        .rect(Math.max(OFFSET_X, sweepX - CELL_SIZE * 0.85), OFFSET_Y, CELL_SIZE * 0.85, GRID_HEIGHT)
        .fill({ color: 0x00d7ff, alpha: 0.09 });
    };

    void (async () => {
      app = new Application();
      await app.init({
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      if (cancelled) {
        app.destroy(true);
        return;
      }

      graphics = new Graphics();
      app.stage.addChild(graphics);
      app.ticker.add(({ lastTime }) => draw(lastTime));
      host.appendChild(app.canvas);
    })();

    return () => {
      cancelled = true;
      if (app) {
        app.destroy(true, { children: true });
      }
      host.replaceChildren();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-label="LLMines PixiJS playfield"
      className="mx-auto aspect-[8/5] w-full max-w-[704px] overflow-hidden rounded-lg border border-white/15 bg-slate-950 shadow-2xl shadow-cyan-950/40"
    />
  );
}
