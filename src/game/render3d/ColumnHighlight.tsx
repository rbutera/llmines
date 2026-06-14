"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLS } from "../core";
import type { RenderState } from "../engine/controller";
import { BOARD_H, CELL, cellX } from "./layout";

/**
 * CURRENT-COLUMN HIGHLIGHT (render-only position indicator). Lightens the full
 * column(s) the active 2x2 piece currently occupies, so the player can read where
 * the piece will land at a glance — a soft vertical wash behind the stack, one
 * strip per occupied column (the 2x2 spans two columns => two strips).
 *
 * Purely cosmetic. Driven each frame from the live controller snapshot (the same
 * `snapRef` Scene3D animates the active piece from), so it tracks the piece with
 * zero React churn and updates as the piece moves L/R. Off when there is no
 * active piece or the game is over.
 *
 * Two pooled additive plane strips (no per-frame allocation): we only ever need
 * two (a 2x2 footprint), parked off-screen when idle. A gentle, slow breathe on
 * the brightness keeps it alive without strobing (a11y: a smooth low-amplitude
 * cosine, never a flash). The strips sit just behind the cubes so the blocks
 * still read on top of the wash.
 */

const STRIP_COUNT = 2; // a 2x2 piece spans exactly two columns

export function ColumnHighlight({
  snapRef,
  /** 0..1 peak opacity of the wash. Subtle by default. */
  opacity = 0.16,
  /** Wash tint (additive). A cool near-white reads as "lit" on any skin. */
  color = "#bcd2ff",
}: {
  snapRef: React.RefObject<RenderState | null>;
  opacity?: number;
  color?: string;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const slotColor = useMemo(() => new THREE.Color(), []);
  // Per-column live brightness (eased toward target) so a column lights/dims
  // smoothly as the piece arrives/leaves, never snapping.
  const level = useRef<number[]>([0, 0]);

  useFrame((s, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const clampedDt = Math.min(dt, 0.05);
    const rs = snapRef.current;
    const active = rs && !rs.gameOver ? rs.active : null;
    // The two columns the piece occupies (or none).
    const cols: number[] = active
      ? [active.pos.col, active.pos.col + 1]
      : [];
    // Gentle breathe (slow cosine, low amplitude) so the wash is alive but calm.
    const breathe = 0.85 + 0.15 * Math.cos(s.clock.elapsedTime * 2.4);

    for (let i = 0; i < STRIP_COUNT; i++) {
      const col = cols[i];
      const onBoard = col != null && col >= 0 && col < COLS;
      const target = onBoard ? 1 : 0;
      // Ease the per-strip level toward its target (fast attack, smooth release).
      const cur = level.current[i]!;
      const k = Math.min(1, clampedDt * 9);
      const next = cur + (target - cur) * k;
      level.current[i] = next;

      if (next <= 0.002 || !onBoard) {
        // Idle / off-board: park off-screen so it draws nothing.
        dummy.position.set(0, 0, -9999);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, slotColor.setRGB(0, 0, 0));
        continue;
      }

      // A full-height strip sitting one cell wide, centred on the column, just
      // behind the cubes (negative z) so the blocks render on top of the wash.
      dummy.position.set(cellX(col), 0, -(CELL - 0.06) - 0.02);
      dummy.scale.set(CELL, BOARD_H, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const b = next * breathe * opacity;
      mesh.setColorAt(
        i,
        slotColor.setRGB(baseColor.r * b, baseColor.g * b, baseColor.b * b),
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, STRIP_COUNT]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        transparent
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
        vertexColors
      />
    </instancedMesh>
  );
}
