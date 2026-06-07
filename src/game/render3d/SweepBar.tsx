"use client";

import { type RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { BOARD_H, CELL, sweepWorldX } from "./layout";

/**
 * The timeline sweep bar: a thin translucent emissive plane at the current
 * sweep world-x, full board height, slightly in front of the cells. Emissive +
 * toneMapped=false so bloom turns it into a glowing line. The x position eases
 * cosmetically toward the snapshot's sweepX each frame (the snapshot is the
 * source of truth; this is purely visual smoothing).
 */
export function SweepBar({ sweepXRef }: { sweepXRef: RefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null);
  const easedX = useRef<number>(0);

  useFrame((_s, dt) => {
    const target = sweepWorldX(sweepXRef.current ?? 0);
    // Ease, but snap on a wrap (big backward jump) so the bar doesn't streak
    // back across the whole board when sweepX wraps from COLS back to 0.
    const cur = easedX.current;
    if (target < cur - CELL * 2) {
      easedX.current = target;
    } else {
      const k = Math.min(1, dt * 18);
      easedX.current = cur + (target - cur) * k;
    }
    if (groupRef.current) groupRef.current.position.x = easedX.current;
  });

  return (
    <group ref={groupRef}>
      {/* Soft glow halo */}
      <mesh position={[0, 0, CELL * 0.5]}>
        <planeGeometry args={[CELL * 0.5, BOARD_H + CELL]} />
        <meshBasicMaterial
          color="#fff2a8"
          transparent
          opacity={0.12}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Bright core line — exceeds the bloom threshold */}
      <mesh position={[0, 0, CELL * 0.55]}>
        <planeGeometry args={[CELL * 0.08, BOARD_H + CELL]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
