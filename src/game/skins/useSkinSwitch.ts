"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BoardPalette,
  type ChromePalette,
  type Skin,
  DEFAULT_SKIN,
  nextSkin,
  skinById,
  SKINS,
} from "./skins";
import { lerpBoard, lerpChrome } from "./crossfade";

/** localStorage key for the chosen skin id (persisted, like the audio mix). */
export const SKIN_STORAGE_KEY = "llmines.skin";

/** Crossfade duration (ms) for the colour transition on a skin switch. */
export const SKIN_CROSSFADE_MS = 1000;

export interface SkinSwitchState {
  /** The skin the game is currently ON (after any in-flight switch settles). */
  skin: Skin;
  /** The interpolated board palette to render THIS frame (mid-crossfade aware). */
  board: BoardPalette;
  /** The interpolated chrome palette to render THIS frame. */
  chrome: ChromePalette;
  /** True while a colour crossfade is animating. */
  transitioning: boolean;
  /** Advance to the next skin in cycle order (button / key trigger). */
  cycleSkin: () => void;
  /** Jump to a specific skin by id (no-op if already there). */
  setSkin: (id: string) => void;
}

/**
 * Owns the active skin + the colour crossfade animation. On a switch it ramps an
 * internal `mix` 0->1 over {@link SKIN_CROSSFADE_MS} via rAF, exposing the
 * interpolated board + chrome palettes each frame so the board recolours and the
 * chrome CSS vars fade smoothly. The actual AUDIO crossfade is the caller's
 * concern — it passes an `onSwitch(skin)` so the engine swaps the song in lock
 * step. The chosen skin id is persisted.
 *
 * Pure-React + rAF; SSR-safe (initial state = default skin, hydrated on mount).
 */
export function useSkinSwitch(onSwitch?: (skin: Skin) => void): SkinSwitchState {
  // `from` -> `to` is the active transition; when settled, from === to.
  const [from, setFrom] = useState<Skin>(DEFAULT_SKIN);
  const [to, setTo] = useState<Skin>(DEFAULT_SKIN);
  const [mix, setMix] = useState(1); // 1 => fully on `to`
  const rafRef = useRef<number | null>(null);
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  // Hydrate the persisted skin on mount (no crossfade — set instantly).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = skinById(window.localStorage.getItem(SKIN_STORAGE_KEY));
    if (stored.id !== DEFAULT_SKIN.id) {
      setFrom(stored);
      setTo(stored);
      setMix(1);
    }
  }, []);

  const startTransition = useCallback((target: Skin) => {
    setTo((curTo) => {
      if (curTo.id === target.id) return curTo;
      // Start the fade FROM whatever is currently fully shown.
      setFrom(curTo);
      setMix(0);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SKIN_STORAGE_KEY, target.id);
      }
      onSwitchRef.current?.(target);
      return target;
    });
  }, []);

  // Drive the crossfade with rAF whenever mix < 1.
  useEffect(() => {
    if (mix >= 1) return;
    let start: number | null = null;
    const tick = (ts: number) => {
      start ??= ts;
      const t = Math.min(1, (ts - start) / SKIN_CROSSFADE_MS + mix);
      setMix(t);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // Re-run only when a NEW transition begins (mix reset to 0); the closure
    // captures the starting mix so we don't restart mid-fade on every setMix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);

  const cycleSkin = useCallback(() => {
    setTo((curTo) => {
      const target = nextSkin(curTo.id);
      setFrom(curTo);
      setMix(0);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SKIN_STORAGE_KEY, target.id);
      }
      onSwitchRef.current?.(target);
      return target;
    });
  }, []);

  const setSkin = useCallback(
    (id: string) => {
      const target = SKINS.find((s) => s.id === id);
      if (target) startTransition(target);
    },
    [startTransition],
  );

  const board = mix >= 1 ? to.board : lerpBoard(from.board, to.board, mix);
  const chrome = mix >= 1 ? to.chrome : lerpChrome(from.chrome, to.chrome, mix);

  return {
    skin: to,
    board,
    chrome,
    transitioning: mix < 1,
    cycleSkin,
    setSkin,
  };
}
