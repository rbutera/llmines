"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BoardPalette,
  type ChromePalette,
  type Skin,
  DEFAULT_SKIN,
  nextSkin,
} from "./skins";
import { lerpBoard, lerpChrome } from "./crossfade";

/** Crossfade duration (ms) for the colour transition on a skin advance. */
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
  /**
   * Advance to the next skin in progression order (wraps last → first), with the
   * colour + audio crossfade. The ONLY progression trigger: called by the audio
   * engine's `onSongComplete`. There is no skin toggle / hotkey / picker.
   */
  advanceSkin: () => void;
  /**
   * Jump instantly (no crossfade) to the base skin `SKINS[0]`. Used on restart /
   * new game so a run always starts on the base skin — the chosen skin never
   * carries across runs (no persistence).
   */
  resetToBaseSkin: () => void;
}

/**
 * Owns the active skin + the colour crossfade animation. On an advance it ramps
 * an internal `mix` 0->1 over {@link SKIN_CROSSFADE_MS} via rAF, exposing the
 * interpolated board + chrome palettes each frame so the board recolours and the
 * chrome CSS vars fade smoothly. The actual AUDIO crossfade is the caller's
 * concern — it passes an `onSwitch(skin)` so the engine swaps the song in lock
 * step.
 *
 * Programmatic-only surface (the skin toggle + N hotkey + pause picker +
 * localStorage persistence are all removed): the skin advances ONLY on song
 * completion (`advanceSkin`), and resets to the base skin on restart
 * (`resetToBaseSkin`). Always starts a fresh load on the base skin.
 *
 * Pure-React + rAF; SSR-safe (initial state = the base skin).
 */
export function useSkinSwitch(onSwitch?: (skin: Skin) => void): SkinSwitchState {
  // `from` -> `to` is the active transition; when settled, from === to.
  const [from, setFrom] = useState<Skin>(DEFAULT_SKIN);
  const [to, setTo] = useState<Skin>(DEFAULT_SKIN);
  const [mix, setMix] = useState(1); // 1 => fully on `to`
  const rafRef = useRef<number | null>(null);
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

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

  const advanceSkin = useCallback(() => {
    setTo((curTo) => {
      const target = nextSkin(curTo.id);
      setFrom(curTo);
      setMix(0);
      onSwitchRef.current?.(target);
      return target;
    });
  }, []);

  const resetToBaseSkin = useCallback(() => {
    // Cancel any in-flight crossfade and jump instantly to the base skin.
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    setFrom(DEFAULT_SKIN);
    setTo(DEFAULT_SKIN);
    setMix(1);
    onSwitchRef.current?.(DEFAULT_SKIN);
  }, []);

  const board = mix >= 1 ? to.board : lerpBoard(from.board, to.board, mix);
  const chrome = mix >= 1 ? to.chrome : lerpChrome(from.chrome, to.chrome, mix);

  return {
    skin: to,
    board,
    chrome,
    transitioning: mix < 1,
    advanceSkin,
    resetToBaseSkin,
  };
}
