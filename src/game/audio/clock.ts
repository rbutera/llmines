import type { Clock } from "../time/clock";

/**
 * Production `Clock` backed by a single shared `AudioContext`. Its `now()`
 * returns `AudioContext.currentTime` (seconds), which is the master clock the
 * sweep — and, later, all audio scheduling (proposal C) — read so they can
 * never drift apart.
 *
 * Exactly ONE `AudioContext` is ever created (module-level singleton). Browsers
 * suspend a freshly-created context until a user gesture, so:
 *   - `now()` reports `0` (no musical time elapsed) until the context is
 *     resumed, so the board waits rather than jumping; and
 *   - `resume()` (called on the first user gesture) starts musical time.
 */

let sharedCtx: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Lazily create (once) and return the single shared AudioContext. */
function getSharedContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

/** A production `Clock` plus the resume hook the controller calls on first gesture. */
export interface AudioClock extends Clock {
  /** Resume the shared AudioContext (call on the first user gesture). */
  resume(): void;
}

/**
 * Create the production audio clock. Must only be called in the browser; never
 * during SSR (the controller guards this — see ControllerOptions defaults).
 *
 * Before the context is resumed, `now()` returns `0` so the controller treats
 * the pre-gesture window as "no musical time elapsed".
 */
export function createAudioClock(): AudioClock {
  const ctx = getSharedContext();
  return {
    now(): number {
      // No context (non-browser) or still suspended → no musical time yet.
      if (!ctx || ctx.state === "suspended") return 0;
      return ctx.currentTime;
    },
    resume(): void {
      if (ctx && ctx.state === "suspended") {
        void ctx.resume();
      }
    },
  };
}

/** Test-only: drop the singleton so a fresh context can be created. */
export function __resetAudioClockForTests(): void {
  sharedCtx = null;
}
