"use client";

// Backing-track audio control (Req 10).
//
// Manages a single looping <audio> element pointing at `/backing-track.mp3`.
// The hook exposes an `audioRef` to attach to a real rendered <audio loop>
// element (so an acceptance test can find an audio source with loop enabled),
// plus `start()`/`stop()` controls. `start()` is called from a user gesture
// (the start-button click) and swallows a rejected `play()` promise so blocked
// autoplay never breaks gameplay — the game simply continues silently.

import { useCallback, useEffect, useRef } from "react";

/** Path to the looping backing-track asset (Req 10.1). */
export const BACKING_TRACK_SRC = "/backing-track.mp3";

/** Options for {@link useBackingTrack}. */
export interface UseBackingTrackOptions {
  /**
   * When false (e.g. Test_Mode, Req 16.3), `start()` is a no-op so audio-synced
   * auto-progression is never triggered by playback.
   */
  enabled: boolean;
}

/** Return value of {@link useBackingTrack}. */
export interface UseBackingTrackResult {
  /** Begin (or resume) looping playback; safe to call from a user gesture. */
  start: () => void;
  /** Pause playback and rewind to the start. */
  stop: () => void;
  /** Ref to attach to a rendered `<audio loop src="/backing-track.mp3">` element. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

export function useBackingTrack(opts: UseBackingTrackOptions): UseBackingTrackResult {
  const { enabled } = opts;
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Keep `loop` asserted on whatever element gets attached, and ensure playback
  // is paused when the component using this hook unmounts. Capture the element
  // at effect time so the cleanup pauses the same node.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.loop = true;
    }
    return () => {
      if (audio !== null) {
        audio.pause();
      }
    };
  }, []);

  const start = useCallback((): void => {
    // Never autoplay in Test_Mode; the host also simply won't call start().
    if (!enabled) return;
    const audio = audioRef.current;
    if (audio === null) return;
    audio.loop = true;
    // Browsers may reject play() when not tied to a user gesture; swallow it so
    // gameplay continues silently rather than throwing (Req 10.3 best-effort).
    const playback = audio.play();
    if (playback !== undefined) {
      playback.catch(() => {
        /* autoplay blocked — continue without music */
      });
    }
  }, [enabled]);

  const stop = useCallback((): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  return { start, stop, audioRef };
}
