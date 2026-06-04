"use client";

import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";

import {
  BOARD_GAP,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_SIZE,
  COLOR_HEX,
  GRID_COLUMNS,
  GRID_ROWS,
} from "~/lib/llmines/constants";
import { markedCells, visibleGrid } from "~/lib/llmines/engine";
import type { GameState } from "~/lib/llmines/types";

export function PixiBoard({ state }: { state: GameState }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Graphics | null>(null);
  const stateRef = useRef(state);

  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    const app = new Application();

    void app
      .init({
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        if (cancelled || !hostRef.current) {
          app.destroy();
          return;
        }
        app.canvas.setAttribute("aria-label", "LLMines playfield");
        app.canvas.className = "board-canvas";
        hostRef.current.appendChild(app.canvas);
        const layer = new Graphics();
        app.stage.addChild(layer);
        appRef.current = app;
        layerRef.current = layer;
        drawBoard(layer, stateRef.current);
      });

    return () => {
      cancelled = true;
      appRef.current?.destroy(true);
      appRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (layerRef.current) drawBoard(layerRef.current, state);
  }, [state]);

  return (
    <div
      ref={hostRef}
      className="board-shell"
      data-sweep-x={state.sweep.x.toFixed(2)}
      aria-label="LLMines 16 by 10 playfield"
    />
  );
}

function drawBoard(layer: Graphics, state: GameState) {
  layer.clear();
  const grid = visibleGrid(state);
  const marked = new Set(
    markedCells(state).map((cell) => `${cell.row}:${cell.col}`),
  );

  layer.roundRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, 8).fill({
    color: 0x08111f,
    alpha: 0.92,
  });

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLUMNS; col += 1) {
      const x = col * CELL_SIZE + BOARD_GAP;
      const y = row * CELL_SIZE + BOARD_GAP;
      layer
        .roundRect(
          x,
          y,
          CELL_SIZE - BOARD_GAP * 2,
          CELL_SIZE - BOARD_GAP * 2,
          4,
        )
        .fill({
          color: 0x142235,
          alpha: 0.8,
        });

      const color = grid[row]?.[col] ?? null;
      if (color === null) continue;

      const isActive =
        state.activePiece !== null &&
        row >= state.activePiece.row &&
        row < state.activePiece.row + 2 &&
        col >= state.activePiece.col &&
        col < state.activePiece.col + 2;
      const isMarked = marked.has(`${row}:${col}`);
      const inset = isActive ? 3 : 4;
      const alpha = isMarked ? 1 : 0.92;

      layer
        .roundRect(
          x + inset,
          y + inset,
          CELL_SIZE - BOARD_GAP * 2 - inset * 2,
          CELL_SIZE - BOARD_GAP * 2 - inset * 2,
          6,
        )
        .fill({ color: COLOR_HEX[color], alpha });

      if (isMarked) {
        layer
          .roundRect(x + 2, y + 2, CELL_SIZE - 8, CELL_SIZE - 8, 7)
          .stroke({ color: 0xffffff, alpha: 0.75, width: 2 });
      }
    }
  }

  const sweepX = Math.min(state.sweep.x, GRID_COLUMNS) * CELL_SIZE;
  layer.rect(sweepX - 2, 0, 4, BOARD_HEIGHT).fill({
    color: 0xffffff,
    alpha: 0.9,
  });
  layer.rect(Math.max(0, sweepX - 10), 0, 20, BOARD_HEIGHT).fill({
    color: 0x8af7ff,
    alpha: 0.16,
  });
}
