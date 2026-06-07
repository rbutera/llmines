"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL } from "./layout";

/**
 * Travelling chain-clear WAVEFRONT (Phase 3). When a chain flood clears a
 * connected component, the clear visibly RADIATES outward from the origin gem
 * along the component: each cleared cell flashes bright then fades, lit in
 * BFS-distance order so the effect sweeps across the shape rather than blinking
 * all at once.
 *
 * Strictly cosmetic. The caller (Scene3D) seeds this from the core's RECORD-ONLY
 * `lastChainClear` payload — origin + each cleared cell tagged with its BFS
 * distance from the origin. We turn distance into a per-cell START DELAY
 * (`dist * msPerRing`) so the flash front travels at one ring per `msPerRing`,
 * then run the existing bright→fade flash after the delay. Timing is driven by
 * the render clock (cosmetic); the deterministic core clock stays the source of
 * truth for gameplay.
 *
 * A FIXED-SIZE pool of additive quads (no per-event allocation): a seed just
 * activates idle slots at the cleared world positions. One instanced draw call.
 * When all slots are idle the draw is effectively free (parked off-screen).
 */

export interface ChainWavefrontHandle {
  /**
   * Seed a wavefront. `cells` are the cleared cells with their world position and
   * BFS distance from the origin. `msPerRing` sets how fast the front travels
   * (ms per distance ring); `intensity` scales the peak flash brightness.
   */
  seed: (
    cells: { position: [number, number, number]; dist: number }[],
    msPerRing: number,
    intensity: number,
  ) => void;
}

const MAX_FLASHES = 256; // hard ceiling across all simultaneous wavefronts
const FADE = 0.16; // seconds: bright -> dark after a cell lights
const RISE = 0.04; // seconds: quick ramp up to peak when a cell lights

export const ChainWavefront = forwardRef<ChainWavefrontHandle>(
  function ChainWavefront(_props, ref) {
    const meshRef = useRef<THREE.InstancedMesh>(null);

    // Per-slot animation state, written in place each frame.
    const state = useMemo(() => {
      const delay = new Float32Array(MAX_FLASHES); // seconds until this cell lights
      const elapsed = new Float32Array(MAX_FLASHES); // seconds since seeded
      const total = new Float32Array(MAX_FLASHES); // delay + RISE + FADE (0 = idle)
      const peak = new Float32Array(MAX_FLASHES); // intensity scale
      const px = new Float32Array(MAX_FLASHES);
      const py = new Float32Array(MAX_FLASHES);
      const pz = new Float32Array(MAX_FLASHES);
      return { delay, elapsed, total, peak, px, py, pz };
    }, []);

    const nextSlot = useRef(0);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const color = useMemo(() => new THREE.Color(), []);

    useImperativeHandle(
      ref,
      (): ChainWavefrontHandle => ({
        seed(cells, msPerRing, intensity) {
          if (cells.length === 0) return;
          const ring = Math.max(0, msPerRing) / 1000; // seconds per dist ring
          for (const c of cells) {
            const i = nextSlot.current;
            nextSlot.current = (nextSlot.current + 1) % MAX_FLASHES;
            state.delay[i] = c.dist * ring;
            state.elapsed[i] = 0;
            state.total[i] = c.dist * ring + RISE + FADE;
            state.peak[i] = intensity;
            state.px[i] = c.position[0];
            state.py[i] = c.position[1];
            state.pz[i] = c.position[2] + CELL * 0.06;
          }
        },
      }),
      [state],
    );

    useFrame((_s, dt) => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const clampedDt = Math.min(dt, 0.05);
      let anyAlive = false;
      for (let i = 0; i < MAX_FLASHES; i++) {
        const total = state.total[i]!;
        if (total <= 0) {
          // Idle: park off-screen at zero scale.
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        anyAlive = true;
        const e = state.elapsed[i]! + clampedDt;
        state.elapsed[i] = e;
        const delay = state.delay[i]!;
        if (e >= total) {
          // Finished: retire the slot.
          state.total[i] = 0;
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        // Brightness envelope: 0 before the delay, quick RISE to peak, then FADE.
        let level: number;
        const since = e - delay;
        if (since <= 0) {
          level = 0;
        } else if (since < RISE) {
          level = since / RISE;
        } else {
          const f = (since - RISE) / FADE; // 0..1 over the fade
          level = Math.max(0, 1 - f);
        }
        const peak = state.peak[i]!;
        const b = level * peak;
        // A flash quad that scales up slightly as it brightens, centred on the
        // cleared cell. Additive blending + emissive colour -> reads as a burst
        // of light travelling across the component.
        const scale = (CELL - 0.06) * (0.6 + 0.5 * level);
        dummy.position.set(state.px[i]!, state.py[i]!, state.pz[i]!);
        dummy.scale.setScalar(level <= 0 ? 0.0001 : scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Warm white-gold flash, brightness baked into the instance colour
        // (additive blending sums it over the scene).
        mesh.setColorAt(i, color.setRGB(b * 1.0, b * 0.92, b * 0.6));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Keep updating one extra frame after the last dies so the parked state
      // is flushed; `anyAlive` covers the active case.
      void anyAlive;
    });

    return (
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_FLASHES]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          vertexColors
        />
      </instancedMesh>
    );
  },
);
