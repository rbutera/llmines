import { GRAVITY_TICK_MS } from "./constants";
import { AudioController } from "./audio";
import { LuminesEngine } from "./engine";
import { attachKeyboard, engineActions } from "./input";
import type { Renderer } from "./render/renderer";
import { installTestApi, uninstallTestApi } from "./testApi";
import { TEST_MODE } from "./testMode";

export interface DriverCallbacks {
  onScore(score: number): void;
  onGameOver(finalScore: number): void;
}

export class GameDriver {
  readonly engine = new LuminesEngine(TEST_MODE ? 1 : (Date.now() | 0));
  private renderer: Renderer;
  private audio = new AudioController();
  private detachKeys: () => void = () => undefined;
  private raf = 0;
  private last = 0;
  private gravityAcc = 0;
  private lastAudioMs = 0;
  private startMs = 0;
  private lastScore = -1;
  private over = false;

  constructor(
    renderer: Renderer,
    private cb: DriverCallbacks,
    audioParent: HTMLElement,
  ) {
    this.renderer = renderer;
    this.audio.attach(audioParent);
  }

  start(): void {
    if (TEST_MODE) {
      installTestApi(this.engine);
    } else {
      this.engine.spawnPiece(); // first piece
      this.audio.play();
      this.detachKeys = attachKeyboard(window, engineActions(this.engine));
    }
    this.last = performanceNow();
    this.loop();
  }

  private loop = (): void => {
    const now = performanceNow();
    const dt = now - this.last;
    this.last = now;
    if (this.startMs === 0) this.startMs = now;

    if (!TEST_MODE) this.simulate(dt);

    const st = this.engine.state();
    this.renderer.draw({
      grid: st.grid,
      marked: this.engine.marked(),
      sweepX: st.sweepX,
      timeMs: now - this.startMs,
    });

    if (st.score !== this.lastScore) {
      this.lastScore = st.score;
      this.cb.onScore(st.score);
    }
    if (st.gameOver && !this.over) {
      this.over = true;
      this.cb.onGameOver(st.score);
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  private simulate(dt: number): void {
    const st = this.engine.state();
    if (st.gameOver) return;

    // Sweep locked to the track: advance by however much the audio clock moved
    // since last frame. If the audio clock isn't progressing (autoplay blocked,
    // paused, or just looped to 0), fall back to rAF dt at the same tempo so the
    // sweep never depends on audio decode. 250ms/col either way.
    const audioMs = this.audio.time * 1000;
    let sweepDelta = audioMs - this.lastAudioMs;
    this.lastAudioMs = audioMs;
    if (sweepDelta <= 0 || sweepDelta > 1000) sweepDelta = dt;
    this.engine.sweepProgress(sweepDelta);

    // Gravity.
    this.gravityAcc += dt;
    const interval = GRAVITY_TICK_MS;
    while (this.gravityAcc >= interval) {
      this.gravityAcc -= interval;
      if (this.engine.hasActive()) {
        this.engine.tick();
      } else {
        this.engine.spawnPiece(); // auto-spawn next piece in production
      }
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detachKeys();
    this.audio.stop();
    if (TEST_MODE) uninstallTestApi();
  }

  destroy(): void {
    this.stop();
    this.renderer.destroy();
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}
