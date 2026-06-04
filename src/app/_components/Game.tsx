"use client";

import { useEffect, useReducer, useRef } from "react";
import { GameController } from "~/game/driver/gameController";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";
import { GameOverScreen } from "./GameOverScreen";
import { Hud } from "./Hud";
import { StartScreen } from "./StartScreen";

export function Game() {
  const controllerRef = useRef<GameController | null>(null);
  controllerRef.current ??= new GameController();
  const controller = controllerRef.current;

  const [, force] = useReducer((n: number) => n + 1, 0);

  // Subscribe to controller state changes.
  useEffect(() => {
    const unsub = controller.subscribe(force);
    return () => {
      unsub();
    };
  }, [controller]);

  // Expose the deterministic test interface only in test-mode builds. The
  // dynamic import is guarded by the build-time TEST_MODE constant so the whole
  // test-api module is dead-code-eliminated (never bundled) in normal builds.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    // Reference the env var DIRECTLY so Next inlines it and the bundler drops
    // this entire branch (and the dynamically-imported chunk) in normal builds.
    if (process.env.NEXT_PUBLIC_TEST_MODE === "1") {
      void import("~/game/test/testApi").then((m) => {
        m.installTestApi(controller);
        dispose = m.uninstallTestApi;
      });
    }
    return () => dispose?.();
  }, [controller]);

  // Tear down the controller (rAF + audio) on unmount.
  useEffect(() => () => controller.destroy(), [controller]);

  // Keyboard controls.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "h":
        case "ArrowLeft":
          controller.moveLeft();
          break;
        case "l":
        case "ArrowRight":
          controller.moveRight();
          break;
        case "k":
        case "ArrowUp":
          controller.rotate();
          break;
        case "j":
        case "ArrowDown":
          controller.setSoftDrop(true);
          e.preventDefault();
          break;
        case " ":
        case "Spacebar":
          controller.hardDrop();
          e.preventDefault();
          break;
        default:
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "j" || e.key === "ArrowDown") controller.setSoftDrop(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controller]);

  const state = controller.getState();
  const phase = state.phase;

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center gap-8 overflow-hidden bg-[radial-gradient(ellipse_at_top,_#1b1140_0%,_#05050f_60%)] p-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,138,60,0.04)_40%,rgba(57,214,255,0.05)_100%)]" />

      {phase === "start" ? (
        <StartScreen onStart={() => controller.start()} />
      ) : (
        <div className="relative z-10 flex flex-col items-center gap-6 lg:flex-row lg:items-start">
          <GameCanvas controller={controller} />

          <aside className="flex w-full max-w-xs flex-col gap-4">
            <Hud score={state.score} />
            <ControlsCheatsheet compact />
          </aside>

          {phase === "gameover" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <GameOverScreen score={state.score} onRestart={() => controller.restart()} />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
