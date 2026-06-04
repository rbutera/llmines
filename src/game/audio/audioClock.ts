import { BACKING_TRACK_SRC, BEAT_MS } from "../constants";

/**
 * Wraps the backing-track <audio> element. The element always has loop enabled
 * and points at /backing-track.mp3 (the pinned audio acceptance). Live autoplay
 * is not required; play() is best-effort and never throws.
 */
export class AudioClock {
  readonly el: HTMLAudioElement;

  constructor() {
    const el = new Audio(BACKING_TRACK_SRC);
    el.loop = true;
    el.preload = "auto";
    el.dataset.testid = "backing-audio";
    el.hidden = true;
    // Mount in the DOM so the audio source (loop + src) is inspectable, per the
    // pinned audio acceptance criterion.
    if (typeof document !== "undefined") document.body.appendChild(el);
    this.el = el;
  }

  /** Best-effort start; respects autoplay policy (no hacks). */
  play(): void {
    void this.el.play().catch(() => {
      /* autoplay may be blocked; gameplay continues regardless */
    });
  }

  pause(): void {
    this.el.pause();
  }

  get isPlaying(): boolean {
    return !this.el.paused && !this.el.ended && this.el.currentTime > 0;
  }

  /** Current playback position in beats (used to phase-lock the sweep). */
  get beats(): number {
    return (this.el.currentTime * 1000) / BEAT_MS;
  }

  destroy(): void {
    this.el.pause();
    this.el.src = "";
    this.el.remove();
  }
}
