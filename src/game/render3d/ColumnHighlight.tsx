"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLS } from "../core";
import type { RenderState } from "../engine/controller";
import { BOARD_H, CELL, GAP, cellX } from "./layout";

/**
 * CURRENT-COLUMN INDICATOR (render-only). Brightens the two VERTICAL GRID LINES
 * that BORDER the active 2x2 piece's footprint — the line on the LEFT of the
 * leftmost occupied column and the line on the RIGHT of the rightmost — so the
 * player can read where the piece will land at a glance.
 *
 * Deliberately NOT a column wash: an earlier full-cell wash sat behind the stack
 * and crushed the contrast of dark blocks in that column (they vanished). These
 * are thin strips sitting exactly ON the cell-border grid lines (between blocks,
 * never behind a block body), so block contrast is untouched — it just makes the
 * bounding grid lines a bit brighter than the rest, exactly like the static grid
 * lines but lit.
 *
 * Two pooled strips (a 2x2 footprint has exactly two bounding lines), parked
 * off-screen when idle. Driven each frame from the live controller snapshot (no
 * React churn); eased so the lines glide as the piece moves L/R. Off when there
 * is no active piece or the game is over.
 */

const STRIP_COUNT = 2; // left + right bounding grid line
/** Strip thickness as a fraction of a cell — a touch fatter than a 1px grid line. */
const LINE_W = CELL * 0.08;
/** Peak opacity of a lit bounding line. */
const LINE_PEAK = 0.85;
/** z of the grid lines (see CellGrid) — sit a hair in front so we overlay them. */
const GRID_Z = -(CELL - GAP) - 0.04 + 0.01;

export function ColumnHighlight({
  snapRef,
  /** Overall brightness scale (1 = default). */
  opacity = 1,
  /** Grid-line colour to BRIGHTEN (the skin's grid/edge colour). */
  color = "#3a2a5e",
}: {
  snapRef: React.RefObject<RenderState | null>;
  opacity?: number;
  color?: string;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // The lit line colour: the grid colour lerped toward white so it reads as the
  // SAME line, just brighter (not a foreign-colour glow).
  const litColor = useMemo(
    () => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5),
    [color],
  );
  const slotColor = useMemo(() => new THREE.Color(), []);
  // Per-strip eased brightness so a line lights/dims smoothly as the piece
  // arrives/leaves, never snapping.
  const level = useRef<number[]>([0, 0]);

  useFrame((s, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const clampedDt = Math.min(dt, 0.05);
    const rs = snapRef.current;
    const active = rs && !rs.gameOver ? rs.active : null;
    // x of the two bounding grid lines: left edge of the leftmost occupied column
    // and right edge of the rightmost. cellX(col) is the column centre.
    const c = active?.pos.col;
    const edges: number[] =
      c != null && c >= 0 && c + 1 < COLS
        ? [cellX(c) - CELL / 2, cellX(c + 1) + CELL / 2]
        : [];
    // Very subtle breathe so the lit lines feel alive but calm (no strobe).
    const breathe = 0.92 + 0.08 * Math.cos(s.clock.elapsedTime * 2.2);

    for (let i = 0; i < STRIP_COUNT; i++) {
      const x = edges[i];
      const on = x != null;
      const target = on ? 1 : 0;
      const cur = level.current[i]!;
      const k = Math.min(1, clampedDt * 10);
      const next = cur + (target - cur) * k;
      level.current[i] = next;

      if (next <= 0.002 || !on) {
        dummy.position.set(0, 0, -9999);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, slotColor.setRGB(0, 0, 0));
        continue;
      }

      // A thin full-height strip ON the bounding grid line.
      dummy.position.set(x, 0, GRID_Z);
      dummy.scale.set(LINE_W, BOARD_H, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const b = next * breathe * LINE_PEAK * opacity;
      mesh.setColorAt(
        i,
        slotColor.setRGB(litColor.r * b, litColor.g * b, litColor.b * b),
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
