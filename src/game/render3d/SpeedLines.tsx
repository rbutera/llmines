"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL } from "./layout";

/**
 * Faint vertical SPEED LINES behind the descending piece for the soft-drop
 * feedback (PART 3). A few thin additive streaks that fade UP from the piece,
 * their opacity + length driven by the shared 0..1 `trailRef` energy (bumped by
 * each soft-drop step in Scene3D, decaying when steps stop). Strictly cosmetic;
 * sits inside the active-piece group so it follows the piece's x/y.
 *
 * Rendered only while the piece is soft-dropping (trail > ~0): when idle the
 * streaks scale to zero so the draw is effectively free.
 */
export function SpeedLines({
  trailRef,
  intensity,
  spanCols = 2,
}: {
  trailRef: RefObject<number>;
  /** dropTrailIntensity from settings (scales opacity/length). */
  intensity: number;
  /** how many columns wide the piece is (streaks spread across it). */
  spanCols?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // A streak per quarter-column across the piece width, jittered.
  const streaks = useMemo(() => {
    const n = 5;
    return Array.from({ length: n }, (_, i) => ({
      x: ((i / (n - 1)) * spanCols - spanCols / 2) * CELL * 0.9,
      jitter: 0.6 + Math.random() * 0.8,
    }));
  }, [spanCols]);

  useFrame(() => {
    const grp = groupRef.current;
    if (!grp) return;
    const trail = Math.max(0, Math.min(1, trailRef.current ?? 0));
    const on = trail > 0.01;
    grp.visible = on;
    if (!on) return;
    const len = (0.6 + trail * 2.2) * CELL; // streaks lengthen with energy
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i]!;
      const child = grp.children[i] as THREE.Mesh | undefined;
      if (!child) continue;
      // streaks rise ABOVE the piece (it falls, they trail upward)
      child.scale.set(1, len * s.jitter, 1);
      child.position.set(s.x, len * 0.5 * s.jitter + CELL * 0.4, CELL * 0.05);
      const mat = matRefs.current[i];
      if (mat) mat.opacity = trail * 0.5 * intensity * s.jitter;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {streaks.map((s, i) => (
        <mesh key={i} position={[s.x, 0, CELL * 0.05]}>
          <planeGeometry args={[CELL * 0.07, 1]} />
          <meshBasicMaterial
            ref={(m) => {
              matRefs.current[i] = m;
            }}
            color="#ffd9a0"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
