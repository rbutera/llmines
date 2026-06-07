"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { COLS, ROWS, type Cell } from "../core";
import type { GameController, RenderState } from "../engine/controller";
import { beatPhase, clearBurstCount, dropHeat } from "../fx/beatFx";
import { clearedCellCount } from "../render/renderer";
import { shouldBurstOnClear } from "../fx/scoreFx";
import type { VisualSettings } from "./settings";
import { Cube } from "./Cube";
import { CellGrid } from "./CellGrid";
import { SweepBar } from "./SweepBar";
import { BackgroundField } from "./BackgroundField";
import { Bursts, type BurstHandle } from "./Bursts";
import { ChainWavefront, type ChainWavefrontHandle } from "./ChainWavefront";
import { PreviewDock } from "./PreviewDock";
import { BOARD_H, BOARD_W, CELL, cellX, cellY } from "./layout";

/**
 * Map a game block colour to the bright/dark aesthetic. The game has two block
 * colours: A = 0, B = 1 (core/types.ts `Color`). Per the validated sandbox look,
 * colour A (0) = BRIGHT (glass crystal + inner orb) and colour B (1) = DARK
 * (night-sky box + inner X).
 */
function isBright(cell: Cell): boolean {
  return cell === 0;
}

interface SettledCellData {
  key: number;
  row: number;
  col: number;
  bright: boolean;
  /** Phase 2: this settled cell carries a chain special (gem). */
  gem: boolean;
  /**
   * FIX 2: this settled cell is part of a completed square and is ABOUT TO CLEAR
   * when the sweep crosses it (from `RenderState.marked`). Drives the bright
   * pulsing "to-clear" emissive; un-marked settled cells stay calm/inert.
   */
  marked: boolean;
}

/**
 * Active-piece cell. `col` is the absolute board column (drives shear + world x).
 * `localRow` is the cell's row WITHIN the 2x2 piece (0 = top, 1 = bottom) — the
 * piece's absolute board row is applied once to the whole group in useFrame from
 * the synchronous snapshot, so the active piece's vertical position never depends
 * on async React state (see FIX 1: no beat/gravity-coupled positional snap).
 */
interface ActiveCellData {
  localRow: 0 | 1;
  col: number;
  bright: boolean;
  gem: boolean;
}

/**
 * The R3F scene. Subscribes to the controller (the SAME contract PixiRenderer
 * used: `controller.subscribe`) and stores the latest RenderState. Settled cells
 * render declaratively; the active piece animates its fall offset in useFrame.
 * The renderer NEVER mutates game state.
 *
 * Phase 2 (Arise VFX) adds, all render-only: a shared beat-phase ref (from
 * sweepX), a soft-drop heat ref (measured from fallProgress velocity, gated by
 * the render-only `softDropping` flag), clear-gated particle bursts, an evolving
 * background shader, a gem indicator on special cells, and an in-canvas preview
 * dock.
 */
export function Scene3D({
  controller,
  settings,
  beatPhaseRef,
}: {
  controller: GameController;
  settings: VisualSettings;
  /** Shared with the host so the bloom pass can breathe on the same beat. */
  beatPhaseRef: React.RefObject<number>;
}) {
  const [settled, setSettled] = useState<SettledCellData[]>([]);
  const [active, setActive] = useState<ActiveCellData[]>([]);
  const [queue, setQueue] = useState<RenderState["queue"]>([]);
  // Live snapshot fields read in useFrame (avoid re-render churn for animation).
  const snapRef = useRef<RenderState | null>(null);
  const sweepXRef = useRef<number>(0);
  const skinIndexRef = useRef<number>(0);
  const heatRef = useRef<number>(0);
  const activeGroupRef = useRef<THREE.Group>(null);
  const burstsRef = useRef<BurstHandle>(null);
  const wavefrontRef = useRef<ChainWavefrontHandle>(null);
  // Phase 3: the last chain-clear id we already fired a wavefront for, so a new
  // `lastChainClear.id` fires exactly once. -1 = none fired yet.
  const lastChainIdRef = useRef<number>(-1);
  // Queue of wavefronts to seed on the next R3F frame (mirrors the burst queue).
  const pendingWavefrontsRef = useRef<
    { cells: { position: [number, number, number]; dist: number }[] }[]
  >([]);

  // Clear-detection bookkeeping (render-only): the previous grid + a queue of
  // clear events to flush into bursts on the next frame inside the R3F loop.
  const prevGridRef = useRef<RenderState["grid"] | null>(null);
  const pendingBurstsRef = useRef<{ positions: [number, number, number][]; count: number }[]>(
    [],
  );
  // Heat velocity tracking (render-only): last fallProgress + wall time.
  const lastFallRef = useRef<{ p: number; t: number } | null>(null);

  useEffect(() => {
    const unsub = controller.subscribe((rs: RenderState) => {
      const prevGrid = prevGridRef.current;
      snapRef.current = rs;
      sweepXRef.current = rs.sweepX;
      skinIndexRef.current = rs.skinIndex;
      setQueue(rs.queue);

      // --- Clear detection -> queue a burst (gated on a REAL clear event). ---
      if (prevGrid) {
        const cleared = clearedCellCount(prevGrid, rs.grid);
        if (shouldBurstOnClear(cleared)) {
          // World positions of the cells that disappeared this frame.
          const positions: [number, number, number][] = [];
          for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
              const was = prevGrid[row]?.[col] ?? null;
              const now = rs.grid[row]?.[col] ?? null;
              if (was !== null && now === null) {
                positions.push([cellX(col), cellY(row), 0]);
              }
            }
          }
          if (positions.length > 0) {
            pendingBurstsRef.current.push({
              positions,
              count: clearBurstCount(
                cleared,
                settings.burstPerCell,
                settings.burstCap,
              ),
            });
          }
        }
      }
      prevGridRef.current = rs.grid;

      // --- Chain wavefront: queue a travelling flash on each NEW chain-clear
      // event (keyed by the core's monotonic id so it fires exactly once). The
      // cleared cells + their BFS distances come straight from the record-only
      // lastChainClear payload; map each cell to its world position. ---
      const chain = rs.lastChainClear;
      if (chain && chain.id !== lastChainIdRef.current) {
        lastChainIdRef.current = chain.id;
        const cells = chain.cells.map((oc) => {
          const row = Math.floor(oc.cell / COLS);
          const col = oc.cell % COLS;
          return {
            position: [cellX(col), cellY(row), 0] as [number, number, number],
            dist: oc.dist,
          };
        });
        if (cells.length > 0) pendingWavefrontsRef.current.push({ cells });
      }

      // --- Settled cells (gem flag from the additive specials set; marked flag
      // from RenderState.marked so to-clear cells get the bright pulse). ---
      const specialSet = new Set(rs.specials);
      // FIX 2: index marked (about-to-clear) settled cells by row*COLS+col.
      const markedSet = new Set(rs.marked.map((m) => m.row * COLS + m.col));
      const next: SettledCellData[] = [];
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const c = rs.grid[row]?.[col] ?? null;
          if (c === null) continue;
          const idx = row * COLS + col;
          next.push({
            key: idx,
            row,
            col,
            bright: isBright(c),
            gem: specialSet.has(idx),
            marked: markedSet.has(idx),
          });
        }
      }
      setSettled(next);

      // --- Active piece (gem flag from active.special.cellIndex, row-major). ---
      // Cells carry only their COLUMN + LOCAL row (0/1 within the piece) + colour.
      // The piece's absolute board row is NOT baked into React state here; it is
      // applied to the whole group every frame in useFrame from the live snapshot,
      // so the active piece's Y can never disagree between the (async) React cube
      // positions and the (sync) per-frame fall offset. (FIX 1.)
      if (rs.active) {
        const { cells, pos } = rs.active;
        const gemIdx = rs.active.special?.cellIndex ?? -1;
        setActive([
          { localRow: 0, col: pos.col, bright: isBright(cells[0][0]), gem: gemIdx === 0 },
          { localRow: 0, col: pos.col + 1, bright: isBright(cells[0][1]), gem: gemIdx === 1 },
          { localRow: 1, col: pos.col, bright: isBright(cells[1][0]), gem: gemIdx === 2 },
          { localRow: 1, col: pos.col + 1, bright: isBright(cells[1][1]), gem: gemIdx === 3 },
        ]);
      } else {
        setActive([]);
      }
    });
    return unsub;
  }, [controller, settings.burstPerCell, settings.burstCap]);

  // Animate the active piece's descent + drive beat-phase + heat + bursts.
  useFrame((s) => {
    const rs = snapRef.current;

    // Shared beat phase (pure function of the sweep position) for cubes + bloom.
    beatPhaseRef.current = beatPhase(sweepXRef.current ?? 0);

    // Flush any queued clear bursts (gated already; just hand to the pool).
    if (settings.burstEnabled && burstsRef.current) {
      const pending = pendingBurstsRef.current;
      for (const b of pending) burstsRef.current.spawn(b.positions, b.count);
    }
    pendingBurstsRef.current.length = 0;

    // Flush any queued chain wavefronts (Phase 3). Each travels at the configured
    // ms/ring with the configured peak intensity; pool retires the slots.
    if (settings.chainEnabled && wavefrontRef.current) {
      const pending = pendingWavefrontsRef.current;
      for (const w of pending)
        wavefrontRef.current.seed(
          w.cells,
          settings.chainSpeed,
          settings.chainIntensity,
        );
    }
    pendingWavefrontsRef.current.length = 0;

    // --- Heat: measure descent velocity (rows/sec) from fallProgress, gated by
    // the render-only softDropping flag so only a deliberate fast drop heats up. ---
    if (rs?.active && settings.heatEnabled && rs.softDropping) {
      const now = s.clock.elapsedTime;
      const last = lastFallRef.current;
      // fallProgress is 0..1 within a row; approximate instantaneous velocity by
      // the per-second change, ignoring wraps (a wrap reads as a big jump we skip).
      if (last && now > last.t) {
        const dp = rs.fallProgress - last.p;
        const dt = now - last.t;
        if (dp > 0 && dt > 0) {
          const rps = dp / dt; // rows per second (within-row fraction/sec)
          const target = dropHeat(rps);
          // ease toward target so it ramps smoothly
          heatRef.current += (target - heatRef.current) * Math.min(1, dt * 8);
        } else {
          heatRef.current += (0 - heatRef.current) * Math.min(1, dt * 8);
        }
      }
      lastFallRef.current = { p: rs.fallProgress, t: now };
    } else {
      // cool down when not soft-dropping
      heatRef.current *= 0.85;
      lastFallRef.current = null;
    }

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
    // FIX 1: position the WHOLE active piece from the live snapshot every frame.
    // The cubes inside this group render at LOCAL rows (top cell at y=0), so the
    // group carries the absolute Y of the piece's top row PLUS the smooth sub-cell
    // fall offset. Both terms come from `snapRef` in this single useFrame, so the
    // row baseline and the fall offset can never disagree for a frame the way the
    // old split (absolute cube Y from async React state + offset from snapRef)
    // did — that disagreement was the per-gravity-tick "jump on the beat". The
    // position is now a pure function of grid coords + fallProgress, with zero
    // beat/sweep term anywhere (beat only ever touches emissive).
    const fallOffset = Math.min(rs.fallProgress, roomBelow) * CELL;
    grp.position.y = cellY(pos.row) - fallOffset;
  });

  const half = useMemo(() => ({ w: BOARD_W, h: BOARD_H }), []);

  return (
    <group>
      {/* Lighting — straight-on key + cool fill, ported from the sandbox. */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 12]} intensity={1.2} />
      <directionalLight position={[-8, -4, 6]} intensity={0.35} />

      {/* Reactive evolving background (behind everything). */}
      {settings.bgEnabled && (
        <BackgroundField
          beatPhaseRef={beatPhaseRef}
          skinIndexRef={skinIndexRef}
          intensity={settings.bgIntensity}
        />
      )}

      {/* Well backplate */}
      <mesh position={[0, 0, -(CELL + 0.1)]}>
        <planeGeometry args={[half.w + 0.4, half.h + 0.4]} />
        <meshStandardMaterial color="#0d1018" roughness={1} metalness={0} />
      </mesh>

      <CellGrid opacity={settings.gridOpacity} />

      {/* Settled stack. Calm/inert by default; cells the sweep is about to clear
          (c.marked) get the bright pulse so the to-clear read is unmistakable. */}
      {settled.map((c) => (
        <Cube
          key={c.key}
          position={[cellX(c.col), cellY(c.row), 0]}
          col={c.col}
          cols={COLS}
          bright={c.bright}
          settings={settings}
          beatPhaseRef={beatPhaseRef}
          isGem={c.gem}
          marked={c.marked}
        />
      ))}

      {/* Active falling piece — animated as a group via useFrame. The group's Y
          (absolute top-row world Y minus the smooth fall offset) is driven each
          frame from the live snapshot; the cubes sit at LOCAL rows so nothing
          positional rides async React state. (FIX 1.) */}
      <group ref={activeGroupRef}>
        {active.map((c, i) => (
          <Cube
            key={`active-${i}`}
            position={[cellX(c.col), -c.localRow * CELL, CELL * 0.02]}
            col={c.col}
            cols={COLS}
            bright={c.bright}
            settings={settings}
            beatPhaseRef={beatPhaseRef}
            heatRef={heatRef}
            isGem={c.gem}
            marked={false}
          />
        ))}
      </group>

      <SweepBar sweepXRef={sweepXRef} />

      {/* Particle bursts on clears (pooled; gated on real clear events). */}
      {settings.burstEnabled && <Bursts ref={burstsRef} />}

      {/* Chain-clear travelling wavefront (Phase 3; pooled; fires once per
          new lastChainClear.id, radiating outward by BFS distance). */}
      {settings.chainEnabled && <ChainWavefront ref={wavefrontRef} />}

      {/* In-canvas next-piece preview dock (top-left gutter). */}
      {settings.previewEnabled && <PreviewDock queue={queue} settings={settings} />}
    </group>
  );
}
