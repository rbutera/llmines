"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { COLS, ROWS, type Cell } from "../core";
import type { GameController, RenderState } from "../engine/controller";
import type { VisualSettings } from "./settings";
import { Cube } from "./Cube";
import { CellGrid } from "./CellGrid";
import { SweepBar } from "./SweepBar";
import { BOARD_H, BOARD_W, CELL, cellX, cellY } from "./layout";

/**
 * Map a game block colour to the bright/dark aesthetic. The game has two block
 * colours: A = 0, B = 1 (core/types.ts `Color`). Per the validated sandbox look,
 * colour A (0) = BRIGHT (glass crystal + inner orb) and colour B (1) = DARK
 * (night-sky box + inner X). This is intentionally the same fixed two-tone read
 * across all skins (the skin's CSS palette tints the HUD/preview; the 3D well
 * keeps the bright/dark synesthesia read). Phase 2 can fold skinIndex into the
 * hue if desired.
 */
function isBright(cell: Cell): boolean {
  return cell === 0;
}

interface SettledCellData {
  key: number;
  row: number;
  col: number;
  bright: boolean;
}

/** Active-piece cell with its grid coords + colour. */
interface ActiveCellData {
  row: number;
  col: number;
  bright: boolean;
}

/**
 * The R3F scene. Subscribes to the controller (the SAME contract PixiRenderer
 * used: `controller.subscribe`) and stores the latest RenderState. Settled cells
 * render declaratively (≈160 max); the active piece animates its fall offset in
 * useFrame from `fallProgress` (cosmetic only — the core clock stays the sole
 * source of truth). The renderer NEVER mutates game state.
 */
export function Scene3D({
  controller,
  settings,
}: {
  controller: GameController;
  settings: VisualSettings;
}) {
  const [settled, setSettled] = useState<SettledCellData[]>([]);
  const [active, setActive] = useState<ActiveCellData[]>([]);
  // Live snapshot fields read in useFrame (avoid re-render churn for animation).
  const snapRef = useRef<RenderState | null>(null);
  const sweepXRef = useRef<number>(0);
  const activeGroupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const unsub = controller.subscribe((rs: RenderState) => {
      snapRef.current = rs;
      sweepXRef.current = rs.sweepX;

      const next: SettledCellData[] = [];
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const c = rs.grid[row]?.[col] ?? null;
          if (c === null) continue;
          next.push({ key: row * COLS + col, row, col, bright: isBright(c) });
        }
      }
      setSettled(next);

      if (rs.active) {
        const { cells, pos } = rs.active;
        setActive([
          { row: pos.row, col: pos.col, bright: isBright(cells[0][0]) },
          { row: pos.row, col: pos.col + 1, bright: isBright(cells[0][1]) },
          { row: pos.row + 1, col: pos.col, bright: isBright(cells[1][0]) },
          { row: pos.row + 1, col: pos.col + 1, bright: isBright(cells[1][1]) },
        ]);
      } else {
        setActive([]);
      }
    });
    return unsub;
  }, [controller]);

  // Animate the active piece's descent: same rest-room clamp the Pixi renderer
  // used so the smooth-fall offset never pushes a cell past where it rests.
  useFrame(() => {
    const rs = snapRef.current;
    const grp = activeGroupRef.current;
    if (!grp) return;
    if (!rs?.active) {
      grp.position.y = 0;
      return;
    }
    const { pos } = rs.active;
    const lowestPieceRow = pos.row + 1;
    const restRoomForColumn = (col: number): number => {
      if (col < 0 || col >= COLS) return 0;
      for (let row = lowestPieceRow + 1; row < ROWS; row++) {
        if (rs.grid[row]?.[col] != null) return row - 1 - lowestPieceRow;
      }
      return ROWS - 1 - lowestPieceRow;
    };
    const roomBelow = Math.max(
      0,
      Math.min(restRoomForColumn(pos.col), restRoomForColumn(pos.col + 1)),
    );
    // World y DECREASES as the piece falls (row increases downward).
    grp.position.y = -Math.min(rs.fallProgress, roomBelow) * CELL;
  });

  const half = useMemo(() => ({ w: BOARD_W, h: BOARD_H }), []);

  return (
    <group>
      {/* Lighting — straight-on key + cool fill, ported from the sandbox. */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 12]} intensity={1.2} />
      <directionalLight position={[-8, -4, 6]} intensity={0.35} />

      {/* Well backplate */}
      <mesh position={[0, 0, -(CELL + 0.1)]}>
        <planeGeometry args={[half.w + 0.4, half.h + 0.4]} />
        <meshStandardMaterial color="#0d1018" roughness={1} metalness={0} />
      </mesh>

      <CellGrid opacity={settings.gridOpacity} />

      {/* Settled stack */}
      {settled.map((c) => (
        <Cube
          key={c.key}
          position={[cellX(c.col), cellY(c.row), 0]}
          col={c.col}
          cols={COLS}
          bright={c.bright}
          settings={settings}
        />
      ))}

      {/* Active falling piece — animated as a group via useFrame. */}
      <group ref={activeGroupRef}>
        {active.map((c, i) => (
          <Cube
            key={`active-${i}`}
            position={[cellX(c.col), cellY(c.row), CELL * 0.02]}
            col={c.col}
            cols={COLS}
            bright={c.bright}
            settings={settings}
          />
        ))}
      </group>

      <SweepBar sweepXRef={sweepXRef} />
    </group>
  );
}
