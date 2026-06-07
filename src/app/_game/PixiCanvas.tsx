"use client";

// Host-layer file (Req 1.1): owns the PixiJS Application lifecycle only.
// This module lives in the host layer, so importing from `pixi.js` is allowed
// here (unlike the pure game core in `src/game/`). Drawing belongs to
// `GameRenderer`; this component keeps its concern strictly to creating and
// destroying the Application and mounting its canvas into a ref'd <div>.

import { useEffect, useRef } from "react";
import { Application } from "pixi.js";

export interface PixiCanvasProps {
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  /**
   * Called once the Application has initialised and its canvas is mounted.
   * May return a cleanup function that runs just before the Application is
   * destroyed (e.g. to tear down a renderer attached to the app).
   */
  onReady?: (app: Application) => void | (() => void);
  /** Optional class applied to the host <div>. */
  className?: string;
}

/**
 * Creates a PixiJS v8 `Application` and mounts its canvas into a ref'd <div> on
 * mount, then destroys it on unmount. Guards against React 18/19 StrictMode
 * double-mount and the async-init race where the effect cleanup runs before
 * `app.init` resolves.
 */
export function PixiCanvas({
  width,
  height,
  onReady,
  className,
}: PixiCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // Track teardown across the async init boundary. If the effect's cleanup
    // runs before `init` resolves, `destroyed` is already true and we tear the
    // freshly-initialised Application down immediately instead of mounting it.
    let destroyed = false;
    let app: Application | null = null;
    let onReadyCleanup: (() => void) | undefined;

    const application = new Application();
    void application
      .init({ width, height, background: 0x0b0b14, antialias: true })
      .then(() => {
        if (destroyed) {
          // Cleanup already requested while we were initialising.
          application.destroy(true, { children: true, texture: true });
          return;
        }
        app = application;
        container.appendChild(application.canvas);
        const maybeCleanup = onReady?.(application);
        if (typeof maybeCleanup === "function") {
          onReadyCleanup = maybeCleanup;
        }
      });

    return () => {
      destroyed = true;
      onReadyCleanup?.();
      // Only destroy if init resolved and stored the app; otherwise the
      // `destroyed` flag above handles teardown once init completes.
      if (app !== null) {
        const canvas = app.canvas;
        if (canvas.parentNode !== null) {
          canvas.parentNode.removeChild(canvas);
        }
        app.destroy(true, { children: true, texture: true });
        app = null;
      }
    };
    // The drawing concern owns reacting to state; we only re-init on size
    // changes or a new onReady callback identity.
  }, [width, height, onReady]);

  return <div ref={containerRef} className={className} />;
}

export default PixiCanvas;
