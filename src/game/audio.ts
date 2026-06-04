import { AUDIO_SRC } from "./constants";

export class AudioController {
  readonly el: HTMLAudioElement;

  constructor() {
    this.el = new Audio(AUDIO_SRC);
    this.el.loop = true;
    this.el.preload = "auto";
    // Tag so the e2e harness can find it in the DOM.
    this.el.setAttribute("data-testid", "backing-audio");
  }

  /** Mount the element so it exists in the DOM for inspection. */
  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
  }

  /** Best-effort start; autoplay rejection is swallowed (not required to pass). */
  play(): void {
    void this.el.play().catch(() => undefined);
  }

  stop(): void {
    this.el.pause();
    this.el.currentTime = 0;
  }

  /** Seconds into the looping track (used to lock the sweep to tempo). */
  get time(): number {
    return this.el.currentTime;
  }
}
