"use client";

import { useEffect, useRef } from "react";
import type { GameController } from "../engine/controller";
import { PixiRenderer } from "../render/renderer";

/**
 * Mounts the PixiJS renderer into a ref'd container and wires it to the
 * controller. The Pixi app is created on mount and fully destroyed on unmount
 * (StrictMode double-invoke safe — async init checks a destroyed flag).
 */
export function GameCanvas({ controller }: { controller: GameController }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new PixiRenderer();
    let cancelled = false;
    void renderer.init(host).then(() => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      renderer.attach(controller);
    });
    return () => {
      cancelled = true;
      renderer.destroy();
    };
  }, [controller]);

  return <div ref={hostRef} className="h-full w-full" />;
}
