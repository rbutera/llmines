"use client";

import { type RefObject, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BOARD_H, BOARD_W, CELL } from "./layout";

/**
 * Reactive evolving background — a single full-bleed plane BEHIND the well,
 * driven by a small custom shader. Colour + flow evolve from `uTime`, gently
 * swell on the beat (`uBeat`, the shared beat-phase in [0,1)), and shift hue per
 * `uSkin` (the current skin index) so each level reads as a distinct mood.
 *
 * Deliberately SUBTLE: a slow drifting nebula, kept dim by `uIntensity` so it is
 * alive but never competes with the board. One draw call, a cheap fragment
 * shader (a couple of sines + a value-noise-ish swirl) — negligible cost.
 *
 * Pure render layer: reads only render-only refs/props, mutates no game state.
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Cheap animated nebula. Hue rotates per skin; a couple of layered sines give a
// slow drifting flow. uBeat adds a tiny brightness swell on the beat (bounded —
// no flash). Intentionally low-frequency so it never strobes.
const fragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uBeat;     // beat phase 0..1
  uniform float uSkin;     // skin index
  uniform float uIntensity;

  vec3 hue2rgb(float h) {
    // simple hue ramp -> rgb
    vec3 c = abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0;
    return clamp(c, 0.0, 1.0);
  }

  void main() {
    vec2 p = vUv - 0.5;
    float t = uTime * 0.06;
    // slow swirling flow field
    float flow =
      sin(p.x * 3.0 + t) * 0.5 +
      sin(p.y * 4.0 - t * 1.3) * 0.5 +
      sin((p.x + p.y) * 5.0 + t * 0.7) * 0.4;
    float r = length(p);
    // Base hue anchored in the VIOLET/MAGENTA family so the background nebula
    // matches the neon-purple board (the old 0.55 base read teal — a cohesion
    // gap). Per-skin shift + drift are kept SMALL so every level stays in the
    // purple world rather than wandering to teal/green. 0.78 ~ violet-magenta.
    float hue = fract(0.78 + uSkin * 0.05 + t * 0.01 + flow * 0.03);
    vec3 col = hue2rgb(hue);
    // radial vignette so the centre (behind the board) stays calm/dark
    float vign = smoothstep(0.85, 0.15, r);
    // gentle beat swell: cos gives a smooth bounded bump, peak on the beat
    float beatSwell = 1.0 + 0.10 * cos(uBeat * 6.2831853);
    float brightness = (0.18 + 0.22 * (flow * 0.5 + 0.5)) * vign * beatSwell;
    gl_FragColor = vec4(col * brightness * uIntensity, 1.0);
  }
`;

export function BackgroundField({
  beatPhaseRef,
  skinIndexRef,
  intensity,
}: {
  beatPhaseRef: RefObject<number>;
  skinIndexRef: RefObject<number>;
  intensity: number;
}) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uSkin: { value: 0 },
      uIntensity: { value: intensity },
    }),
    // created once; values pushed live in useFrame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((s) => {
    // Mutate the stable uniforms object directly (it IS the material's uniforms,
    // shared by reference) so the types stay precise.
    uniforms.uTime.value = s.clock.elapsedTime;
    uniforms.uBeat.value = beatPhaseRef.current ?? 0;
    uniforms.uSkin.value = skinIndexRef.current ?? 0;
    uniforms.uIntensity.value = intensity;
  });

  // Sit well behind everything (further than the deepest cube body + grid) and
  // size generously past the well so the nebula bleeds to the canvas edges.
  return (
    <mesh position={[0, 0, -(CELL * 4)]}>
      <planeGeometry args={[BOARD_W * 2.2, BOARD_H * 2.2]} />
      <shaderMaterial
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
