"use client";

import { useEffect, useRef } from "react";
import { GameDriver } from "~/game/driver";
import { Renderer } from "~/game/render/renderer";

interface Props {
  onScore: (score: number) => void;
  onGameOver: (finalScore: number) => void;
}

export function GameCanvas({ onScore, onGameOver }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Keep latest callbacks without re-running the mount effect.
  const cbRef = useRef({ onScore, onGameOver });
  cbRef.current = { onScore, onGameOver };

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    let driver: GameDriver | null = null;
    let cancelled = false;

    void (async () => {
      const renderer = await Renderer.create(parent);
      if (cancelled) {
        renderer.destroy();
        return;
      }
      driver = new GameDriver(
        renderer,
        {
          onScore: (s) => cbRef.current.onScore(s),
          onGameOver: (s) => cbRef.current.onGameOver(s),
        },
        parent,
      );
      driver.start();
    })();

    return () => {
      cancelled = true;
      driver?.destroy();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="relative overflow-hidden rounded-xl shadow-[0_0_60px_-15px_rgba(76,194,255,0.6)] ring-1 ring-white/10"
    />
  );
}
