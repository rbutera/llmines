"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { COLS, ROWS } from "../core";
import { BOARD_H, BOARD_W, CELL, GAP } from "./layout";

/**
 * Thin static cell grid on the well back-plane. NOT sheared — it's the fixed
 * well. LineSegments over the COLS+1 vertical and ROWS+1 horizontal cell
 * boundaries. Dim cool blue, low opacity — a depth cue, not a feature.
 * Ported from the sandbox.
 */
export function CellGrid({ opacity }: { opacity: number }) {
  const geom = useMemo(() => {
    const pts: number[] = [];
    const z = -(CELL - GAP) - 0.04; // just behind the deepest cube body
    const halfW = BOARD_W / 2;
    const halfH = BOARD_H / 2;
    for (let c = 0; c <= COLS; c++) {
      const x = -halfW + c * CELL;
      pts.push(x, -halfH, z, x, halfH, z);
    }
    for (let r = 0; r <= ROWS; r++) {
      const yy = -halfH + r * CELL;
      pts.push(-halfW, yy, z, halfW, yy, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  useEffect(() => () => geom.dispose(), [geom]);

  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#2a3550" transparent opacity={opacity} />
    </lineSegments>
  );
}
