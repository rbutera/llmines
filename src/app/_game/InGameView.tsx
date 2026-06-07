"use client";

// In_Game_View (Req 1.1, 7.3, 10.1, 10.2, 11.3, 12.2, 20.3).
//
// Hosts the PixiJS canvas, a live Score HUD, and the persistent controls
// legend. Renders the looping <audio> element wired to the backing-track hook
// so an audio source with loop enabled exists in the DOM (Req 10.1, 10.2). The
// score readout carries `data-testid="score"` (Test_Mode only) whose text is
// exactly the current score number (Req 20.3).

import type { Application } from "pixi.js";

import { ControlsCheatsheet } from "~/app/_game/ControlsCheatsheet";
import { PixiCanvas } from "~/app/_game/PixiCanvas";
import { BACKING_TRACK_SRC } from "~/app/_game/useBackingTrack";
import { tid } from "~/app/_game/testMode";

/** Canvas size: 640×400 keeps the 16×10 playfield at a clean 16:10. */
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 400;

export interface InGameViewProps {
  /** Called once the PixiJS Application is ready (to attach the renderer). */
  onReady: (app: Application) => void | (() => void);
  /** Current score for the HUD (Req 7.3, 20.3). */
  score: number;
  /** Ref for the looping backing-track <audio> element (Req 10.1, 10.2). */
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

/**
 * The playing screen: canvas on the left, a HUD panel (score + controls) on the
 * right that reflows below the canvas on narrow viewports (Req 14.4).
 */
export function InGameView({
  onReady,
  score,
  audioRef,
}: InGameViewProps): React.JSX.Element {
  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
      <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
        <PixiCanvas
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onReady={onReady}
          className="block"
        />
      </div>

      <div className="flex w-full max-w-xs flex-col gap-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <h2 className="text-sm font-semibold tracking-wide text-white/60 uppercase">
            Score
          </h2>
          <p
            {...tid("score")}
            className="mt-1 font-mono text-4xl font-bold text-teal-300 tabular-nums"
          >
            {score}
          </p>
        </div>

        <ControlsCheatsheet />
      </div>

      {/* Looping backing-track source (Req 10.1, 10.2). */}
      <audio ref={audioRef} src={BACKING_TRACK_SRC} loop preload="auto" />
    </div>
  );
}

export default InGameView;
