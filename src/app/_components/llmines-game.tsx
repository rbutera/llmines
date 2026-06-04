"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Application, Graphics } from "pixi.js";

import {
  COLS,
  LuminesEngine,
  MS_PER_COL,
  ROWS,
  type Color,
  type Grid,
  type MarkedCell,
  type Piece,
} from "~/lib/lumines-engine";

interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: Grid;
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): MarkedCell[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

type Screen = "start" | "playing" | "game-over";

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";
const CELL = 34;
const FIELD_WIDTH = COLS * CELL;
const FIELD_HEIGHT = ROWS * CELL;
const NORMAL_GRAVITY_MS = 520;
const SOFT_DROP_MS = 65;
const COLORS: Record<Color, number> = {
  0: 0x23d5e8,
  1: 0xffcf4a,
};
const COLOR_SHADOWS: Record<Color, number> = {
  0: 0x0b6a7a,
  1: 0xad6423,
};

export function LLminesGame() {
  const pixiHostRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef(new LuminesEngine());
  const keyStateRef = useRef(new Set<string>());
  const screenRef = useRef<Screen>("start");
  const gravityMsRef = useRef(0);
  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const fieldVisible = screen !== "start";

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const syncUi = useCallback(() => {
    const applyState = () => {
      const state = engineRef.current.state();
      setScore(state.score);
      if (state.gameOver && screenRef.current === "playing") {
        setScreen("game-over");
      }
      setRenderTick((value) => value + 1);
    };

    if (TEST_MODE) {
      flushSync(applyState);
      return;
    }

    applyState();
  }, []);

  const startGame = useCallback(() => {
    engineRef.current.reset();
    setScore(0);
    setScreen("playing");
    gravityMsRef.current = 0;
    keyStateRef.current.clear();

    if (!TEST_MODE) {
      engineRef.current.spawn();
      void audioRef.current?.play().catch(() => undefined);
    }

    syncUi();
  }, [syncUi]);

  const restartGame = useCallback(() => {
    startGame();
  }, [startGame]);

  useEffect(() => {
    if (!TEST_MODE) return;

    window.__lumines = {
      seed(n: number) {
        engineRef.current.seed(n);
        syncUi();
      },
      state() {
        return engineRef.current.state();
      },
      marked() {
        return engineRef.current.marked();
      },
      spawn(piece: Piece) {
        engineRef.current.spawn(piece);
        syncUi();
      },
      tick() {
        engineRef.current.tick(false);
        syncUi();
      },
      sweepNow() {
        engineRef.current.sweepNow();
        syncUi();
      },
      sweepProgress(dtMs: number) {
        engineRef.current.sweepProgress(dtMs);
        syncUi();
      },
    };

    return () => {
      delete window.__lumines;
    };
  }, [syncUi]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isControl =
        ["h", "j", "k", "l"].includes(key) ||
        ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"].includes(
          event.code,
        );

      if (isControl) event.preventDefault();

      if (screenRef.current === "start" && (event.code === "Space" || event.key === "Enter")) {
        startGame();
        return;
      }

      if (screenRef.current !== "playing") return;

      const engine = engineRef.current;
      if (key === "h" || event.code === "ArrowLeft") engine.move(-1);
      if (key === "l" || event.code === "ArrowRight") engine.move(1);
      if (key === "k" || event.code === "ArrowUp") engine.rotate();
      if (event.code === "Space") engine.hardDrop(!TEST_MODE);
      if (key === "j" || event.code === "ArrowDown") keyStateRef.current.add("soft");

      syncUi();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "j" || event.code === "ArrowDown") {
        keyStateRef.current.delete("soft");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startGame, syncUi]);

  useEffect(() => {
    if (!fieldVisible) return;

    const host = pixiHostRef.current;
    if (!host) return;

    let cancelled = false;
    const app = new Application();
    const scene = new Graphics();

    void app
      .init({
        width: FIELD_WIDTH,
        height: FIELD_HEIGHT,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true);
          return;
        }

        host.appendChild(app.canvas);
        app.stage.addChild(scene);

        app.ticker.add((ticker) => {
          const deltaMs = Math.min(ticker.deltaMS, 50);

          if (screenRef.current === "playing" && !TEST_MODE) {
            engineRef.current.sweepProgress(deltaMs);
            gravityMsRef.current += deltaMs;

            const gravityLimit = keyStateRef.current.has("soft")
              ? SOFT_DROP_MS
              : NORMAL_GRAVITY_MS;

            while (gravityMsRef.current >= gravityLimit) {
              engineRef.current.tick(true);
              gravityMsRef.current -= gravityLimit;
            }

            const state = engineRef.current.state();
            setScore((current) => (current === state.score ? current : state.score));
            if (state.gameOver) setScreen("game-over");
          }

          drawScene(scene, engineRef.current, performance.now());
        });
      });

    return () => {
      cancelled = true;
      app.destroy(true);
    };
  }, [fieldVisible]);

  useEffect(() => {
    drawFallbackIfNeeded(engineRef.current);
  }, [renderTick]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#101214] text-[#f5f7f8]">
      <audio ref={audioRef} src="/backing-track.mp3" loop preload="auto" />

      {screen === "start" && (
        <section className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-8 lg:grid-cols-[1fr_390px]">
          <div className="space-y-7">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.28em] text-[#23d5e8]">
                120 BPM timeline puzzle
              </p>
              <h1 className="max-w-3xl text-6xl font-black leading-none tracking-normal text-white sm:text-8xl">
                LLMines
              </h1>
            </div>
            <p className="max-w-2xl text-xl leading-8 text-[#c8d1d6]">
              Drop two-tone 2x2 blocks, build same-colour squares, and time the
              sweep so one pass clears bigger clusters for a larger multiplier.
            </p>
            <button
              data-testid="start-button"
              className="inline-flex h-14 items-center border border-[#23d5e8] bg-[#23d5e8] px-8 text-base font-bold uppercase tracking-[0.18em] text-[#071214] shadow-[0_0_30px_rgba(35,213,232,0.35)] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#23d5e8]/40"
              onClick={startGame}
            >
              Start
            </button>
          </div>

          <ControlsPanel variant="start" />
        </section>
      )}

      {fieldVisible && (
        <section className="mx-auto grid min-h-screen max-w-7xl grid-rows-[auto_1fr] gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-1 lg:items-center lg:px-8">
          <div className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#23d5e8]">
                  LLMines
                </p>
                <h2 className="text-3xl font-black tracking-normal text-white">
                  Timeline Field
                </h2>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#98a8ae]">
                  Score
                </p>
                <p
                  data-testid="score"
                  className="font-mono text-4xl font-black text-[#ffcf4a]"
                >
                  {score}
                </p>
              </div>
            </div>

            <div className="field-shell mx-auto max-w-full overflow-hidden border border-white/10 bg-[#090c0e] p-2 shadow-[0_30px_80px_rgba(0,0,0,0.4)] lg:mx-0">
              <div
                ref={pixiHostRef}
                aria-label="LLMines playfield"
                className="aspect-[16/10] w-full max-w-[544px]"
              />
            </div>
          </div>

          <aside className="space-y-4">
            <ControlsPanel variant="game" />
            <div className="border border-white/10 bg-[#171b1e] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.26)]">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-[#ffcf4a]">
                Sweep
              </p>
              <p className="text-sm leading-6 text-[#c8d1d6]">
                The bar crosses all 16 columns every 4 seconds: {MS_PER_COL}ms
                per column at 120 BPM.
              </p>
            </div>
          </aside>
        </section>
      )}

      {screen === "game-over" && (
        <div className="fixed inset-0 grid place-items-center bg-[#050607]/80 px-4 backdrop-blur-sm">
          <section
            data-testid="game-over"
            className="w-full max-w-md border border-[#ffcf4a]/50 bg-[#151719] p-7 text-center shadow-[0_0_60px_rgba(255,207,74,0.22)]"
          >
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-[#ffcf4a]">
              Game over
            </p>
            <h2 className="mb-2 text-4xl font-black tracking-normal text-white">
              Final score {score}
            </h2>
            <button
              data-testid="restart"
              className="mt-6 h-12 border border-[#23d5e8] bg-[#23d5e8] px-7 text-sm font-bold uppercase tracking-[0.18em] text-[#071214] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#23d5e8]/40"
              onClick={restartGame}
            >
              Restart
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function ControlsPanel({ variant }: { variant: "start" | "game" }) {
  return (
    <section
      data-testid="controls-cheatsheet"
      className="border border-white/10 bg-[#171b1e] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.26)]"
    >
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#23d5e8]">
        Controls
      </p>
      <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-3 text-sm">
        <KeyTerm>h / ←</KeyTerm>
        <dd>Move left</dd>
        <KeyTerm>l / →</KeyTerm>
        <dd>Move right</dd>
        <KeyTerm>j / ↓</KeyTerm>
        <dd>Soft-drop</dd>
        <KeyTerm>k / ↑</KeyTerm>
        <dd>Rotate</dd>
        <KeyTerm>space</KeyTerm>
        <dd>Hard-drop</dd>
      </dl>
      <p className="mt-5 text-sm leading-6 text-[#c8d1d6]">
        Form same-colour 2x2 squares or larger regions. Marked cells clear when
        the timeline crosses their columns, then the stack collapses into the
        gaps.
      </p>
      {variant === "game" && (
        <p className="mt-3 text-xs leading-5 text-[#98a8ae]">
          Larger monochrome blocks count every aligned 2x2 inside them.
        </p>
      )}
    </section>
  );
}

function KeyTerm({ children }: { children: React.ReactNode }) {
  return (
    <dt className="min-h-8 border border-white/10 bg-[#0c1012] px-2 py-1 text-center font-mono text-xs font-bold uppercase leading-6 text-[#f5f7f8]">
      {children}
    </dt>
  );
}

function drawScene(graphics: Graphics, engine: LuminesEngine, nowMs: number): void {
  const state = engine.state();
  const settled = engine.getSettledGrid();
  const active = engine.getActive();
  const marked = new Set(engine.marked().map(({ row, col }) => `${row}:${col}`));
  const pulse = 0.5 + Math.sin(nowMs / 130) * 0.5;

  graphics.clear();
  graphics.rect(0, 0, FIELD_WIDTH, FIELD_HEIGHT).fill({ color: 0x080b0d });

  for (let col = 0; col <= COLS; col += 1) {
    const x = col * CELL;
    graphics.rect(x, 0, 1, FIELD_HEIGHT).fill({ color: 0x243039, alpha: 0.72 });
  }

  for (let row = 0; row <= ROWS; row += 1) {
    const y = row * CELL;
    graphics.rect(0, y, FIELD_WIDTH, 1).fill({ color: 0x243039, alpha: 0.72 });
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const color = settled[row]?.[col];
      if (color !== null && color !== undefined) {
        drawBlock(graphics, col, row, color, marked.has(`${row}:${col}`), pulse, false);
      }
    }
  }

  if (active) {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const row = active.y + dy;
        const col = active.x + dx;
        const color = active.cells[dy]![dx]!;
        drawBlock(graphics, col, row, color, false, pulse, true);
      }
    }
  }

  const sweepX = state.sweepX * CELL;
  graphics
    .rect(Math.max(0, sweepX - 10), 0, 20, FIELD_HEIGHT)
    .fill({ color: 0xffffff, alpha: 0.08 });
  graphics
    .rect(Math.max(0, sweepX - 2), 0, 4, FIELD_HEIGHT)
    .fill({ color: 0xffffff, alpha: 0.92 });
  graphics
    .rect(Math.max(0, sweepX - 18), 0, 3, FIELD_HEIGHT)
    .fill({ color: 0x23d5e8, alpha: 0.68 });
}

function drawBlock(
  graphics: Graphics,
  col: number,
  row: number,
  color: Color,
  marked: boolean,
  pulse: number,
  active: boolean,
): void {
  const x = col * CELL + 3;
  const y = row * CELL + 3;
  const size = CELL - 6;
  const inset = active ? 1 : 0;
  const fill = COLORS[color];
  const shadow = COLOR_SHADOWS[color];

  graphics
    .roundRect(x - inset, y - inset, size + inset * 2, size + inset * 2, 4)
    .fill({ color: shadow, alpha: active ? 0.98 : 0.9 });
  graphics
    .roundRect(x + 3, y + 3, size - 6, size - 6, 3)
    .fill({ color: fill, alpha: active ? 1 : 0.94 });
  graphics
    .rect(x + 5, y + 5, size - 10, 3)
    .fill({ color: 0xffffff, alpha: active ? 0.42 : 0.28 });

  if (marked) {
    graphics
      .roundRect(x - 1, y - 1, size + 2, size + 2, 5)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.55 + pulse * 0.4 });
    graphics
      .rect(x + 2, y + size - 5, size - 4, 3)
      .fill({ color: 0xffffff, alpha: 0.25 + pulse * 0.35 });
  }
}

function drawFallbackIfNeeded(_engine: LuminesEngine): void {
  // React state changes wake the component in test mode while Pixi's ticker
  // remains responsible for all visible drawing.
}
