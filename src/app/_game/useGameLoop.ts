"use client";

// Normal-play game loop (Req 6.1, 6.2, 10.4, 16.3).
//
// While `enabled` and a PixiJS Application is ready, this hook subscribes to the
// shared ticker and drives two cadences off `ticker.deltaMS`:
//
//   * Gravity: accumulate elapsed time and call `engine.gravityStep()` every
//     GRAVITY_INTERVAL_MS (or a faster SOFT_DROP_INTERVAL_MS while soft-drop is
//     held). After a step that locks the active block, auto-spawn the next piece
//     during normal play (Req 2.3); if that spawn is blocked, fire `onGameOver`.
//   * Sweep: advance the Timeline_Bar continuously by `deltaMS` each frame so it
//     stays locked to tempo (Req 6.1, 6.2, 10.4).
//
// In Test_Mode (`enabled === false`) nothing is registered, so state advances
// only through explicit Test_Api calls (Req 16.3). Callbacks and the engine are
// held in a ref to avoid stale closures and to keep the subscription stable
// across renders.

import { useEffect, useRef } from "react";
import type { Application, Ticker } from "pixi.js";

import { GRAVITY_INTERVAL_MS } from "~/game/constants";
import type { GameEngine } from "~/game/engine";

/** Faster gravity cadence while soft-drop is held (Req 4.3). */
const SOFT_DROP_INTERVAL_MS = 60;

/** Options for {@link useGameLoop}. */
export interface UseGameLoopOptions {
  /** When false (Test_Mode), the loop is fully disabled (Req 16.3). */
  enabled: boolean;
  /** The PixiJS application whose ticker drives the loop, or null until ready. */
  app: Application | null;
  /** The engine to advance. */
  engine: GameEngine;
  /** Invoked once when a spawn is blocked and the game ends (Req 9.1). */
  onGameOver?: () => void;
  /** Invoked each frame so the React HUD (e.g. score) can update. */
  onChange?: () => void;
}

export function useGameLoop(opts: UseGameLoopOptions): void {
  const { enabled, app } = opts;

  const ref = useRef<{
    engine: GameEngine;
    onGameOver?: () => void;
    onChange?: () => void;
  }>({ engine: opts.engine, onGameOver: opts.onGameOver, onChange: opts.onChange });
  ref.current = {
    engine: opts.engine,
    onGameOver: opts.onGameOver,
    onChange: opts.onChange,
  };

  useEffect(() => {
    if (!enabled || app === null) return;

    let gravityAccumMs = 0;
    let gameOverNotified = false;

    const onTick = (ticker: Ticker): void => {
      const dtMs = ticker.deltaMS;
      const { engine, onGameOver, onChange } = ref.current;

      const state = engine.getState();
      if (state.gameOver) {
        if (!gameOverNotified) {
          gameOverNotified = true;
          onGameOver?.();
        }
        return;
      }

      // --- Gravity cadence ---------------------------------------------------
      const interval = state.softDrop ? SOFT_DROP_INTERVAL_MS : GRAVITY_INTERVAL_MS;
      gravityAccumMs += dtMs;
      while (gravityAccumMs >= interval) {
        gravityAccumMs -= interval;
        engine.gravityStep();
        // The block locked (became quiescent): spawn the next piece in normal
        // play (Req 2.3). A blocked spawn ends the game (Req 9.1).
        if (engine.getState().active === null) {
          engine.spawnRandom();
          if (engine.getState().gameOver) {
            if (!gameOverNotified) {
              gameOverNotified = true;
              onGameOver?.();
            }
            break;
          }
        }
      }

      // --- Sweep cadence -----------------------------------------------------
      // Advance the bar continuously; deletions/scoring happen inside the engine.
      engine.sweepProgress(dtMs);

      onChange?.();
    };

    app.ticker.add(onTick);

    return () => {
      app.ticker.remove(onTick);
    };
  }, [enabled, app]);
}
