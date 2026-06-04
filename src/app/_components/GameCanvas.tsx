"use client";

import { useEffect, useRef } from "react";
import { PixiRenderer } from "~/game/render/PixiRenderer";
import type { GameController } from "~/game/driver/gameController";

export function GameCanvas({ controller }: { controller: GameController }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: PixiRenderer | null = new PixiRenderer(controller.getState);
    void renderer.mount(host);
    return () => {
      renderer?.destroy();
      renderer = null;
    };
  }, [controller]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-xl shadow-2xl shadow-fuchsia-900/30 ring-1 ring-white/10"
      aria-label="Game playfield"
    />
  );
}
