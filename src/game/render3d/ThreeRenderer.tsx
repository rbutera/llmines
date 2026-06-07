"use client";

import { useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Leva } from "leva";
import { BOARD_ASPECT } from "../core";
import type { GameController } from "../engine/controller";
import { Scene3D } from "./Scene3D";
import { useVisualSettings } from "./useVisualSettings";
import { PREVIEW_GUTTER } from "./PreviewDock";
import { BOARD_H, BOARD_W, CELL } from "./layout";

/**
 * FIX 4: auto-fit the orthographic zoom to the live canvas size so the well (plus
 * the preview gutter) FILLS the canvas, and recompute on every resize. For a
 * drei OrthographicCamera, `zoom` is pixels-per-world-unit, so to fit a world
 * extent `W`x`H` into a `Cw`x`Ch` canvas we take `min(Cw/W, Ch/H)` (min => never
 * crop) times a small fill factor for breathing room. The `userZoom` slider
 * multiplies this fit so the panel still tunes framing on top of the auto-fit.
 * Reads the reactive `size` from R3F (updates on resize) and writes the default
 * camera's zoom each render.
 */
function AutoFitCamera({
  userZoom,
  baseZoom,
  gutter,
}: {
  userZoom: number;
  baseZoom: number;
  gutter: number;
}) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  // World extent to frame: the board, widened by the preview gutter (one-sided),
  // plus a margin so the bloom/edges and the dock aren't clipped at the edge.
  const worldW = BOARD_W + gutter + CELL * 1.2;
  const worldH = BOARD_H + CELL * 1.2;
  const fit = Math.min(size.width / worldW, size.height / worldH);
  // baseZoom is the panel's reference (default 30) — normalise so userZoom=baseZoom
  // means "auto-fit", and moving the slider scales around it.
  const zoom = fit * (userZoom / baseZoom);
  if ((camera as { isOrthographicCamera?: boolean }).isOrthographicCamera) {
    const ortho = camera as unknown as { zoom: number; updateProjectionMatrix: () => void };
    if (ortho.zoom !== zoom) {
      ortho.zoom = zoom;
      ortho.updateProjectionMatrix();
    }
  }
  return null;
}

/**
 * Top-level Three.js / react-three-fiber renderer host. Mounts an `<Canvas>`
 * with an orthographic straight-on camera, the bloom post pass, and the live
 * (persisted) settings panel. The canvas is `aria-hidden` exactly as the Pixi
 * canvas was, so the window.__lumines + getByTestId test layer is unaffected.
 *
 * BEAT-REACTIVE BLOOM (Phase 2): the `<Bloom>` pass itself is kept STATIC and a
 * direct child of `<EffectComposer>` — `@react-three/postprocessing` v3 chokes
 * (circular-JSON in its reconciler) if the Bloom pass is wrapped or its effect
 * ref is mutated per frame. Instead the bloom BREATHES on the beat because its
 * INPUT breathes: the cubes' emissive (orbs, side faces, sweep) pulse gently on
 * the beat in Cube.tsx, so the bloom that feeds off those bright pixels swells
 * with them. Same visible result (bloom + emissive breathe together on the beat),
 * zero risk to the composer. Gentle cosine swell only — never a strobe (a11y).
 *
 * Phase 2 also shifts the camera left + zooms out a touch to reveal the in-canvas
 * preview gutter beside the well, and threads a shared `beatPhaseRef` (written
 * from sweepX) to the scene so every breathing element pulses in sync.
 */
export function ThreeRenderer({ controller }: { controller: GameController }) {
  const settings = useVisualSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  // Shared beat phase (0..1), written once per frame by Scene3D from sweepX and
  // read by the cubes so all emissive breathing pulses together.
  const beatPhaseRef = useRef<number>(0);

  // The preview dock lives in a gutter to the LEFT of the well. Shift the camera
  // left by ~half the gutter so both the well and the gutter sit centred in frame.
  // (The zoom is now auto-fit to the canvas — see AutoFitCamera — so the board
  // fills the big canvas instead of floating small in it.)
  const gutter = settings.previewEnabled ? PREVIEW_GUTTER : 0;
  const gutterShift = settings.previewEnabled ? PREVIEW_GUTTER / 2 + CELL * 0.3 : 0;

  return (
    <div
      className="relative max-h-full max-w-full overflow-hidden rounded-xl ring-1 shadow-2xl ring-white/10"
      style={{
        // FIX 4: fill the available space at the fixed board aspect. The parent
        // (PlayingScreen) gives this a tall flex region; `height: 100%` + an
        // aspect-ratio box makes the canvas as large as the viewport allows
        // (width follows from the aspect), with max-h/max-w guarding overflow.
        height: "100%",
        aspectRatio: BOARD_ASPECT,
        boxShadow: "0 0 60px -15px #37e0c980",
      }}
    >
      {/* Settings panel — hidden until toggled so it never blocks play. */}
      <Leva hidden={!panelOpen} collapsed={false} />
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        aria-pressed={panelOpen}
        className="absolute top-2 right-2 z-20 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-black/60"
      >
        {panelOpen ? "Hide settings" : "Settings"}
      </button>

      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <color attach="background" args={["#0a0a12"]} />

        {/* Flat orthographic camera, straight-on. The side-face reveal comes
            entirely from the per-column shear, not the camera. Shifted left to
            reveal the preview gutter. */}
        <OrthographicCamera
          makeDefault
          position={[-gutterShift, 0, 60]}
          zoom={settings.zoom}
          near={0.1}
          far={500}
        />
        {/* FIX 4: keep the well filling the (now much larger) canvas, responsive
            to resize. Overrides the camera zoom each frame to the fit value. */}
        <AutoFitCamera userZoom={settings.zoom} baseZoom={30} gutter={gutter} />

        <Scene3D
          controller={controller}
          settings={settings}
          beatPhaseRef={beatPhaseRef}
        />

        <EffectComposer>
          <Bloom
            intensity={settings.bloomIntensity}
            luminanceThreshold={settings.luminanceThreshold}
            luminanceSmoothing={0.025}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
