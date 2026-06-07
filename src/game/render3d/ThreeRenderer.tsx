"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Leva } from "leva";
import { BOARD_ASPECT } from "../core";
import type { GameController } from "../engine/controller";
import { Scene3D } from "./Scene3D";
import { useVisualSettings } from "./useVisualSettings";

/**
 * Top-level Three.js / react-three-fiber renderer host. Replaces the imperative
 * PixiRenderer mount. Mounts an `<Canvas>` with an orthographic straight-on
 * camera, the bloom post-processing pass, and the live (persisted) settings
 * panel. The canvas is `aria-hidden` exactly as the Pixi canvas was, so the
 * window.__lumines + getByTestId test layer is unaffected by the swap.
 *
 * The settings panel (leva) is toggleable so it never blocks play; the toggle
 * state is local UI only. All visual params live in useVisualSettings (persisted
 * to localStorage).
 */
export function ThreeRenderer({ controller }: { controller: GameController }) {
  const settings = useVisualSettings();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl ring-1 shadow-2xl ring-white/10"
      style={{ aspectRatio: BOARD_ASPECT, boxShadow: "0 0 60px -15px #37e0c980" }}
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
            entirely from the per-column shear, not the camera. */}
        <OrthographicCamera
          makeDefault
          position={[0, 0, 60]}
          zoom={settings.zoom}
          near={0.1}
          far={500}
        />

        <Scene3D controller={controller} settings={settings} />

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
