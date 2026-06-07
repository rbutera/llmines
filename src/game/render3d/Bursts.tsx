"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL } from "./layout";

/**
 * Imperative particle-burst pool for clear events. A FIXED-SIZE pool of points
 * (no per-clear allocation — the pool is sized once to `MAX_PARTICLES`); a burst
 * just activates idle particles at the cleared world positions with random
 * outward velocities and a short life. When all are idle the geometry draw is
 * effectively free. One `<points>` draw call total.
 *
 * Strictly cosmetic: the caller (Scene3D) gates `spawn` on a real clear event
 * (`clearedCellCount > 0`) and passes the capped particle count — this component
 * just renders them. No game state is touched.
 */

export interface BurstHandle {
  /** Spawn `count` particles distributed across the given world positions. */
  spawn: (positions: [number, number, number][], count: number) => void;
}

const MAX_PARTICLES = 240; // hard ceiling across all simultaneous bursts
const LIFE = 0.7; // seconds

export const Bursts = forwardRef<BurstHandle>(function Bursts(_props, ref) {
  const pointsRef = useRef<THREE.Points>(null);

  // Pre-allocated buffers, written in place each frame.
  const { positions, velocities, life, geometry } = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const life = new Float32Array(MAX_PARTICLES); // remaining seconds; 0 = idle
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Park idle particles far off-screen so they don't render at the origin.
    for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 2] = -9999;
    return { positions, velocities, life, geometry };
  }, []);

  const nextIdle = useRef(0);

  useImperativeHandle(
    ref,
    (): BurstHandle => ({
      spawn(worldPositions, count) {
        if (count <= 0 || worldPositions.length === 0) return;
        const capped = Math.min(count, MAX_PARTICLES);
        for (let n = 0; n < capped; n++) {
          // round-robin a slot (overwrites the oldest if saturated)
          const i = nextIdle.current;
          nextIdle.current = (nextIdle.current + 1) % MAX_PARTICLES;
          const src =
            worldPositions[n % worldPositions.length] ?? worldPositions[0]!;
          positions[i * 3] = src[0];
          positions[i * 3 + 1] = src[1];
          positions[i * 3 + 2] = src[2] + CELL * 0.1;
          // random outward-ish velocity in world units/sec
          const ang = Math.random() * Math.PI * 2;
          const spd = CELL * (1.5 + Math.random() * 2.5);
          velocities[i * 3] = Math.cos(ang) * spd;
          velocities[i * 3 + 1] = Math.sin(ang) * spd + CELL * 1.5; // bias up
          velocities[i * 3 + 2] = (Math.random() - 0.5) * CELL * 2;
          life[i] = LIFE;
        }
      },
    }),
    [positions, velocities, life],
  );

  useFrame((_s, dt) => {
    const geo = pointsRef.current?.geometry;
    if (!geo) return;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const clampedDt = Math.min(dt, 0.05);
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const remaining = life[i]!;
      if (remaining <= 0) continue;
      anyAlive = true;
      const next = remaining - clampedDt;
      life[i] = next;
      const b = i * 3;
      if (next <= 0) {
        // Park dead particles off-screen (additive => they vanish cleanly).
        positions[b + 2] = -9999;
        continue;
      }
      // integrate with a little gravity
      const vy = velocities[b + 1]! - CELL * 4 * clampedDt; // gravity
      velocities[b + 1] = vy;
      positions[b] = positions[b]! + velocities[b]! * clampedDt;
      positions[b + 1] = positions[b + 1]! + vy * clampedDt;
      positions[b + 2] = positions[b + 2]! + velocities[b + 2]! * clampedDt;
    }
    if (anyAlive) posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={CELL * 0.28}
        color="#fff4c2"
        transparent
        opacity={0.95}
        depthWrite={false}
        toneMapped={false}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
});
