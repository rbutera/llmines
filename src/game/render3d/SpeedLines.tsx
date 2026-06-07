"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL } from "./layout";

/**
 * Motion-blur SPEED STREAK for the descending piece (item 4 rework). The old
 * version was a few faint thin lines hanging off the top of the block — it read
 * as decorative "strings", not speed. This instead draws a small number of WIDE,
 * vertical, additive streak quads spanning the piece's columns that trail UPWARD
 * from the piece (the path it just fell through) and STRETCH with speed — so the
 * block visibly smears, conveying velocity. Energy comes from the shared 0..1
 * `trailRef` (bumped by each soft-drop step in Scene3D, decaying when steps
 * stop). Strictly cosmetic; sits inside the active-piece group so it follows the
 * piece's x/y. When idle (trail ~0) the group hides, so the draw is free.
 *
 * Soft-drop = a sustained, brighter trail (the piece glides continuously while
 * held). The hard-drop SLAM impact is a separate component (SlamFlash); this is
 * the in-motion speed cue.
 */
export function SpeedLines({
  trailRef,
  intensity,
  spanCols = 2,
}: {
  trailRef: RefObject<number>;
  /** dropTrailIntensity from settings (scales opacity/length). */
  intensity: number;
  /** how many columns wide the piece is (the smear spans it). */
  spanCols?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // One wide smear column per piece column, plus a centred core smear. Wide
  // quads (not thin strings) so the effect reads as motion blur on the block.
  const smears = useMemo(() => {
    const cols = Math.max(1, spanCols);
    const arr: { x: number; w: number; jitter: number }[] = [];
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * CELL;
      arr.push({ x, w: CELL * 0.82, jitter: 1 });
    }
    // a brighter, slightly narrower core streak down the middle
    arr.push({ x: 0, w: CELL * 0.4, jitter: 1.25 });
    return arr;
  }, [spanCols]);

  useFrame(() => {
    const grp = groupRef.current;
    if (!grp) return;
    const trail = Math.max(0, Math.min(1, trailRef.current ?? 0));
    const on = trail > 0.01;
    grp.visible = on;
    if (!on) return;
    // The smear LENGTHENS hard with speed so the block visibly streaks. Base of
    // the quad sits at the piece; it extends UPWARD (the way it fell from).
    const len = (1.2 + trail * 5.0) * CELL;
    for (let i = 0; i < smears.length; i++) {
      const s = smears[i]!;
      const child = grp.children[i] as THREE.Mesh | undefined;
      if (!child) continue;
      child.scale.set(1, len, 1);
      // anchor the unit-tall quad so it grows upward from just above the piece
      child.position.set(s.x, len * 0.5 + CELL * 0.45, CELL * 0.04);
      const mat = matRefs.current[i];
      if (mat) {
        // brighter with speed; the core streak (last) hotter than the column smears
        const base = i === smears.length - 1 ? 0.85 : 0.5;
        mat.opacity = Math.min(1, trail * base * intensity * s.jitter);
      }
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {smears.map((s, i) => (
        <mesh key={i} position={[s.x, 0, CELL * 0.04]}>
          <planeGeometry args={[s.w, 1]} />
          <meshBasicMaterial
            ref={(m) => {
              matRefs.current[i] = m;
            }}
            color={i === smears.length - 1 ? "#fff2c4" : "#ffce7a"}
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
