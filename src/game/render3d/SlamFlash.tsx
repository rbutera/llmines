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
 * Hard-drop SLAM impact (item 4 rework). The old slam was only a faint dust
 * puff + a small shake — it didn't read as an impact. This adds the visible
 * SLAM: when a piece hard-drops, a bright impact FLASH BAR snaps in at the
 * landing row (a wide, white-hot horizontal streak across the columns the piece
 * hit) and a tall SPEED STREAK marks the path it slammed down through, both
 * flaring instantly and decaying fast. Together with the (bumped) screen-shake
 * and spark puff, the landing punches and reads as speed instantly.
 *
 * Strictly cosmetic + pooled (a small fixed set of reusable meshes, no per-slam
 * allocation). Caller (Scene3D) fires `slam(...)` once per new hard-drop event.
 */

export interface SlamHandle {
  /**
   * Fire a slam. All coordinates are WORLD-space (the caller maps board
   * cols/rows to world via cellX/cellY): `cx` = centre x of the hit columns,
   * `impactY` = world y of the landing row, `topY` = world y the piece started
   * its drop from (for the descent streak), `width` = world width across the hit
   * columns. `mag` (0..1) scales brightness + length; `intensity` is the
   * settings multiplier.
   */
  slam: (args: {
    cx: number;
    impactY: number;
    topY: number;
    width: number;
    mag: number;
    intensity: number;
  }) => void;
}

interface SlamState {
  life: number; // remaining seconds, 0 = idle
  ttl: number;
  // impact bar
  barX: number;
  barY: number;
  barW: number;
  // descent streak
  streakX: number;
  streakY: number;
  streakH: number;
  peak: number; // peak opacity
}

const POOL = 4; // concurrent slams (plenty; round-robin)
const TTL = 0.32; // seconds — snappy

// y-position of a row in centred world space (mirrors layout.cellY without the
// import cycle risk; ROWS handled by the caller passing world rows is overkill,
// so accept world Y directly from the caller via cellY there). We take world Y.

export const SlamFlash = forwardRef<SlamHandle>(function SlamFlash(_props, ref) {
  const groupRef = useRef<THREE.Group>(null);
  const slamsRef = useRef<SlamState[]>(
    Array.from({ length: POOL }, () => ({
      life: 0,
      ttl: TTL,
      barX: 0,
      barY: 0,
      barW: CELL,
      streakX: 0,
      streakY: 0,
      streakH: CELL,
      peak: 1,
    })),
  );
  const nextRef = useRef(0);

  // Per-slam meshes: [0..POOL) impact bars, [POOL..2*POOL) descent streaks.
  const barMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const streakMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useImperativeHandle(
    ref,
    (): SlamHandle => ({
      slam({ cx, impactY, topY, width, mag, intensity }) {
        const i = nextRef.current;
        nextRef.current = (nextRef.current + 1) % POOL;
        const slam = slamsRef.current[i]!;
        slam.life = TTL;
        slam.peak = Math.min(1, (0.7 + mag * 0.6) * Math.max(0.4, intensity));
        // impact bar: spans the hit columns + a little overhang, at impact row.
        slam.barX = cx;
        slam.barY = impactY;
        slam.barW = width + CELL * 0.6;
        // descent streak: from start row down to impact row, centred on cols.
        slam.streakX = cx;
        slam.streakY = (topY + impactY) / 2;
        slam.streakH = Math.max(CELL, Math.abs(topY - impactY) + CELL);
      },
    }),
    [],
  );

  useFrame((_s, dt) => {
    const grp = groupRef.current;
    if (!grp) return;
    const clampedDt = Math.min(dt, 0.05);
    for (let i = 0; i < POOL; i++) {
      const slam = slamsRef.current[i]!;
      const bar = grp.children[i] as THREE.Mesh | undefined;
      const streak = grp.children[POOL + i] as THREE.Mesh | undefined;
      if (slam.life <= 0) {
        if (bar) bar.visible = false;
        if (streak) streak.visible = false;
        continue;
      }
      slam.life = Math.max(0, slam.life - clampedDt);
      const t = slam.life / slam.ttl; // 1 -> 0
      // ease-out flare: bright snap then quick fade.
      const a = slam.peak * t * t;
      if (bar) {
        bar.visible = true;
        // impact bar flares WIDE then settles; thin tall flash line.
        bar.position.set(slam.barX, slam.barY, CELL * 0.12);
        bar.scale.set(slam.barW * (1 + (1 - t) * 0.4), CELL * 0.5 * (0.4 + t), 1);
        const m = barMatRefs.current[i];
        if (m) m.opacity = a;
      }
      if (streak) {
        streak.visible = true;
        streak.position.set(slam.streakX, slam.streakY, CELL * 0.06);
        // streak fades faster than the bar (it's the trail, not the impact).
        streak.scale.set(CELL * 1.3, slam.streakH, 1);
        const m = streakMatRefs.current[i];
        if (m) m.opacity = a * 0.6 * t;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* impact bars */}
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={`bar-${i}`} geometry={geom} visible={false}>
          <meshBasicMaterial
            ref={(m) => {
              barMatRefs.current[i] = m;
            }}
            color="#ffffff"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {/* descent streaks */}
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={`streak-${i}`} geometry={geom} visible={false}>
          <meshBasicMaterial
            ref={(m) => {
              streakMatRefs.current[i] = m;
            }}
            color="#bfe8ff"
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
});
