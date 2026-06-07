"use client";

// Keyboard input for normal play (Req 4).
//
// Maps vim-style keys (and arrow-key aliases) to GameEngine calls. The listener
// is bound to `window` only while `enabled` is true and removed on cleanup or
// when disabled. The latest `engine`/`onChange` are held in a ref so that the
// listener is bound once per `enabled` transition rather than re-bound on every
// render (which would otherwise thrash add/removeEventListener each frame).

import { useEffect, useRef } from "react";

import type { GameEngine } from "~/game/engine";

/** Options for {@link useKeyboardControls}. */
export interface UseKeyboardControlsOptions {
  /** When false, no listeners are attached (e.g. Test_Mode or non-playing screens). */
  enabled: boolean;
  /** The engine to drive. */
  engine: GameEngine;
  /** Invoked after a state-changing action so the host can re-render mirrored state. */
  onChange?: () => void;
}

/**
 * Discrete actions are fired once per physical key press; key autorepeat (which
 * fires repeated `keydown` events while a key is held) is ignored for them by
 * tracking the set of currently-pressed keys. Soft-drop is intentionally a hold:
 * `keydown` enables it and `keyup` disables it.
 */
export function useKeyboardControls(opts: UseKeyboardControlsOptions): void {
  const { enabled } = opts;

  // Hold the latest engine/onChange so handlers always see current values
  // without forcing the bind effect to re-run on every render.
  const ref = useRef<{ engine: GameEngine; onChange?: () => void }>({
    engine: opts.engine,
    onChange: opts.onChange,
  });
  ref.current = { engine: opts.engine, onChange: opts.onChange };

  useEffect(() => {
    if (!enabled) return;

    // Track held keys to suppress OS autorepeat for discrete actions.
    const pressed = new Set<string>();

    /** Normalise an event key to a canonical control key, or null if unhandled. */
    const normalize = (key: string): string | null => {
      switch (key) {
        case "h":
        case "H":
        case "ArrowLeft":
          return "h";
        case "l":
        case "L":
        case "ArrowRight":
          return "l";
        case "k":
        case "K":
        case "ArrowUp":
          return "k";
        case "j":
        case "J":
        case "ArrowDown":
          return "j";
        case " ":
        case "Spacebar": // legacy key name
          return " ";
        default:
          return null;
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = normalize(event.key);
      if (action === null) return;

      // All handled keys consume the event so arrows/space don't scroll the page.
      event.preventDefault();

      const { engine, onChange } = ref.current;

      // Soft-drop is a hold: keep it enabled while the key is down. Allow the
      // repeated keydown events through (they simply re-assert the flag).
      if (action === "j") {
        engine.setSoftDrop(true);
        pressed.add(action);
        onChange?.();
        return;
      }

      // Discrete actions: ignore autorepeat while the key remains held.
      if (pressed.has(action)) return;
      pressed.add(action);

      switch (action) {
        case "h":
          engine.moveLeft();
          break;
        case "l":
          engine.moveRight();
          break;
        case "k":
          engine.rotate();
          break;
        case " ":
          engine.hardDrop();
          break;
      }
      onChange?.();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const action = normalize(event.key);
      if (action === null) return;

      event.preventDefault();
      pressed.delete(action);

      // Releasing the soft-drop key restores the normal descent rate.
      if (action === "j") {
        const { engine, onChange } = ref.current;
        engine.setSoftDrop(false);
        onChange?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled]);
}
