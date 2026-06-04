"use client";

import { useEffect, useRef } from "react";
import { Application } from "pixi.js";

import type { GameEngine } from "~/game/engine";
import { LuminesRenderer, boardPixelSize } from "~/game/renderer";

const CELL = 40;

export function GameBoard({ engine }: { engine: GameEngine }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { width, height } = boardPixelSize(CELL);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let app: Application | null = null;
    let renderer: LuminesRenderer | null = null;

    void (async () => {
      const a = new Application();
      await a.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
      if (cancelled) {
        a.destroy(true, { children: true });
        return;
      }
      a.canvas.style.width = `${width}px`;
      a.canvas.style.height = `${height}px`;
      host.appendChild(a.canvas);
      renderer = new LuminesRenderer(a, engine, CELL);
      app = a;
    })();

    return () => {
      cancelled = true;
      renderer?.destroy();
      app?.destroy(true, { children: true });
    };
  }, [engine, width, height]);

  return (
    <div
      ref={hostRef}
      className="rounded-2xl shadow-[0_0_60px_-15px_rgba(125,249,255,0.45)]"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
