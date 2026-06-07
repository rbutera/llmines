"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { CELL } from "./layout";

/**
 * 3D drop SURROUND (replaces the flat SlamFlash bar/streak + SpeedLines smear
 * planes, which read as 2D decals under the straight-on ortho camera).
 *
 * Built from BOXES, not camera-facing planes, so it carries genuine 3D volume
 * from this camera the same way the board cubes do. Three parts:
 *
 *  1. AIR-RESISTANCE band (soft-drop, round-2 rework — owner). On a SOFT drop the
 *     effect concentrates on the LEADING (bottom) edge of the falling piece, as
 *     if air resistance is pushing UP against the bottom cells: a hot compressed
 *     glow band hugging the bottom edge that bulges DOWNWARD + brightens with
 *     soft-drop energy, plus two upward-deflecting wisps peeling off the bottom
 *     corners. It tracks the piece (rotation-aware: a 2x2's leading edge is its
 *     bottom edge, which follows the piece position). Distinct from the hard-drop.
 *
 *  2. AFTER-IMAGES (trail) — a small POOL of ghost box hulls stamped in WORLD
 *     space as the piece descends with energy; each fades + shrinks in place over
 *     ~0.25s, stringing UP the column with real depth/overlap (a 3D motion trail,
 *     not an upward plane).
 *
 *  3. IMPACT SHELL (hard-drop burst — KEEP EXACTLY, owner: "SICK"). On a
 *     hard-drop landing a box hull snaps to the piece footprint at the landing
 *     row then EXPANDS outward + fades over ~0.3s: an expanding 3D shock cage.
 *     Pairs with the (kept) screen-shake + spark burst.
 *
 * Strictly cosmetic + pooled (fixed mesh sets, no per-event allocation). Seeded
 * only from render-only signals (drop energy + the hard-drop event queue); the
 * deterministic core is untouched.
 */

const GHOST_POOL = 6; // concurrent after-images
const GHOST_TTL = 0.26; // seconds
const GHOST_STAMP_INTERVAL = 0.045; // min seconds between stamps while moving
const IMPACT_POOL = 3; // concurrent impact shells
const IMPACT_TTL = 0.34;

/** Hull dimensions that wrap a piece spanning `spanCols` x `spanRows` cells.
 *  Pure so the wrap sizing is unit-testable without R3F. Returns [w, h, d].
 *  The hull is a touch larger than the footprint so it reads as a cage AROUND
 *  the piece, and given real depth (z) so it is volumetric, never a flat decal. */
export function dropShellSize(
  spanCols: number,
  spanRows: number,
): [number, number, number] {
  const margin = 0.34;
  return [
    spanCols * CELL + margin,
    spanRows * CELL + margin,
    CELL + margin, // genuine depth so the shell is a 3D hull, not a plane
  ];
}

export interface DropShellHandle {
  /** Fire a hard-drop impact shell at a world position with footprint width. */
  impact: (args: {
    cx: number;
    cy: number;
    width: number;
    mag: number;
    intensity: number;
  }) => void;
}

interface GhostState {
  life: number;
  x: number;
  y: number;
}

interface ImpactState {
  life: number;
  x: number;
  y: number;
  w: number;
  peak: number;
}

/**
 * @param energyRef shared 0..1 drop energy (trail/heat). Drives the shell
 *   opacity/bulge + the ghost stamping cadence.
 * @param activeWorldRef live world (x,y) of the piece centre. The shell tracks
 *   this; the ghost trail is stamped here in WORLD space (so it is LEFT BEHIND in
 *   the column the piece fell through, not carried with the piece). Null = no
 *   active piece (shell hides).
 * @param intensity dropTrailIntensity from settings (scales opacity).
 */
export const DropShell = forwardRef<
  DropShellHandle,
  {
    energyRef: RefObject<number>;
    activeWorldRef: RefObject<{ x: number; y: number } | null>;
    intensity: number;
  }
>(function DropShell({ energyRef, activeWorldRef, intensity }, ref) {
  // Air-resistance band group (soft-drop): hugs the piece's leading/bottom edge,
  // world-positioned each frame. A core glow band + two corner deflection wisps.
  const airRef = useRef<THREE.Group>(null);
  const airBandMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const airWispLMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const airWispRMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // World-space ghost trail + impact shells live in a separate root group.
  const trailRootRef = useRef<THREE.Group>(null);
  const ghostsRef = useRef<GhostState[]>(
    Array.from({ length: GHOST_POOL }, () => ({ life: 0, x: 0, y: 0 })),
  );
  const ghostNextRef = useRef(0);
  const lastStampRef = useRef(0);
  const ghostMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const impactsRef = useRef<ImpactState[]>(
    Array.from({ length: IMPACT_POOL }, () => ({
      life: 0,
      x: 0,
      y: 0,
      w: CELL,
      peak: 1,
    })),
  );
  const impactNextRef = useRef(0);
  const impactMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const [shellW, shellH, shellD] = useMemo(() => dropShellSize(2, 2), []);

  useImperativeHandle(
    ref,
    (): DropShellHandle => ({
      impact({ cx, cy, width, mag, intensity: it }) {
        const i = impactNextRef.current;
        impactNextRef.current = (impactNextRef.current + 1) % IMPACT_POOL;
        const im = impactsRef.current[i]!;
        im.life = IMPACT_TTL;
        im.x = cx;
        im.y = cy;
        im.w = width;
        im.peak = Math.min(1.2, (0.7 + mag * 0.7) * Math.max(0.4, it));
      },
    }),
    [],
  );

  useFrame((s, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    const energy = Math.max(0, Math.min(1, energyRef.current ?? 0));
    const now = s.clock.elapsedTime;
    const world = activeWorldRef.current;

    // --- 1. AIR-RESISTANCE band (soft-drop): leading/bottom-edge effect. ---
    // World-positioned at the piece's BOTTOM edge (world.y is the 2x2 centre, so
    // the bottom edge is ~one cell below). A hot band hugs that edge and bulges
    // DOWNWARD + brightens with soft-drop energy (air piling up under the leading
    // cells); two wisps peel up off the bottom corners (deflected airflow). Hidden
    // at rest, so a stationary / hard-dropping piece shows nothing here.
    const air = airRef.current;
    if (air) {
      const on = !!world && energy > 0.02;
      air.visible = on;
      if (on && world) {
        const bottomY = world.y - CELL; // leading edge of the 2x2
        air.position.set(world.x, bottomY, CELL * 0.16);
        // The band squashes (wider + thinner) and pushes down as energy rises —
        // compressed air under the leading edge.
        const e = energy * Math.max(0.5, intensity);
        if (airBandMatRef.current) {
          airBandMatRef.current.opacity = Math.min(0.85, 0.25 + e * 0.7);
        }
        const band = air.children[0] as THREE.Mesh | undefined;
        if (band) {
          band.scale.set(1 + energy * 0.5, 0.5 + energy * 0.9, 1);
          band.position.y = -energy * CELL * 0.18; // pushed down with speed
        }
        // Corner wisps: peel UP and OUT from the bottom corners, flickering, to
        // read as deflected airflow. Length + opacity scale with energy.
        const flick = 0.7 + 0.3 * Math.sin(now * 22);
        const wispLen = (0.4 + energy * 1.1) * CELL;
        const wL = air.children[1] as THREE.Mesh | undefined;
        const wR = air.children[2] as THREE.Mesh | undefined;
        if (wL) {
          wL.scale.set(1, wispLen, 1);
          wL.position.set(-CELL * (0.55 + energy * 0.2), wispLen * 0.4, 0);
        }
        if (wR) {
          wR.scale.set(1, wispLen, 1);
          wR.position.set(CELL * (0.55 + energy * 0.2), wispLen * 0.4, 0);
        }
        const wispOp = Math.min(0.7, e * 0.6) * flick;
        if (airWispLMatRef.current) airWispLMatRef.current.opacity = wispOp;
        if (airWispRMatRef.current) airWispRMatRef.current.opacity = wispOp;
      }
    }

    // --- 2. After-image stamping (world space) — only while moving + energetic.
    lastStampRef.current += clampedDt;
    if (
      world &&
      energy > 0.12 &&
      lastStampRef.current >= GHOST_STAMP_INTERVAL
    ) {
      lastStampRef.current = 0;
      const gi = ghostNextRef.current;
      ghostNextRef.current = (ghostNextRef.current + 1) % GHOST_POOL;
      const g = ghostsRef.current[gi]!;
      g.life = GHOST_TTL;
      g.x = world.x;
      g.y = world.y;
    }

    // animate ghosts (fade + shrink in place).
    const trailRoot = trailRootRef.current;
    if (trailRoot) {
      for (let i = 0; i < GHOST_POOL; i++) {
        const g = ghostsRef.current[i]!;
        const mesh = trailRoot.children[i] as THREE.Mesh | undefined;
        if (!mesh) continue;
        if (g.life <= 0) {
          mesh.visible = false;
          continue;
        }
        g.life = Math.max(0, g.life - clampedDt);
        const t = g.life / GHOST_TTL; // 1 -> 0
        mesh.visible = true;
        mesh.position.set(g.x, g.y, CELL * 0.08);
        const sc = 0.6 + t * 0.45;
        mesh.scale.set(sc, sc, 1);
        const mat = ghostMatRefs.current[i];
        if (mat) mat.opacity = t * t * 0.4 * Math.max(0.5, intensity);
      }
    }

    // --- 3. Impact shells: snap then expand + fade. ---
    if (trailRoot) {
      for (let i = 0; i < IMPACT_POOL; i++) {
        const im = impactsRef.current[i]!;
        const mesh = trailRoot.children[GHOST_POOL + i] as THREE.Mesh | undefined;
        if (!mesh) continue;
        if (im.life <= 0) {
          mesh.visible = false;
          continue;
        }
        im.life = Math.max(0, im.life - clampedDt);
        const t = im.life / IMPACT_TTL; // 1 -> 0
        const grow = 1 + (1 - t) * 1.4; // expands outward as it fades
        mesh.visible = true;
        mesh.position.set(im.x, im.y, CELL * 0.12);
        mesh.scale.set((im.w + CELL) * 0.5 * grow, CELL * grow, 1 + (1 - t) * 0.8);
        const mat = impactMatRefs.current[i];
        if (mat) mat.opacity = im.peak * t * t;
      }
    }
  });

  return (
    <>
      {/* AIR-RESISTANCE band (soft-drop) — world-positioned each frame at the
          piece's leading/bottom edge. child[0] = hot compression band hugging the
          bottom edge; child[1]/child[2] = corner deflection wisps peeling up. */}
      <group ref={airRef} visible={false}>
        {/* [0] compression band — wide, thin, hugging the bottom edge */}
        <mesh>
          <boxGeometry args={[shellW * 0.96, CELL * 0.34, shellD * 0.7]} />
          <meshBasicMaterial
            ref={airBandMatRef}
            color="#ff8de6"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
          <Edges color="#ffd6f6" />
        </mesh>
        {/* [1] left corner wisp — unit-tall, scaled in useFrame */}
        <mesh>
          <boxGeometry args={[CELL * 0.16, 1, CELL * 0.16]} />
          <meshBasicMaterial
            ref={airWispLMatRef}
            color="#ffb3ee"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* [2] right corner wisp */}
        <mesh>
          <boxGeometry args={[CELL * 0.16, 1, CELL * 0.16]} />
          <meshBasicMaterial
            ref={airWispRMatRef}
            color="#ffb3ee"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* World-space trail + impacts — rendered at scene root by the caller. */}
      <group ref={trailRootRef}>
        {/* ghost after-images (box hulls with glowing edges) */}
        {Array.from({ length: GHOST_POOL }, (_, i) => (
          <mesh key={`ghost-${i}`} visible={false}>
            <boxGeometry args={[shellW * 0.92, shellH * 0.92, shellD * 0.92]} />
            <meshBasicMaterial
              ref={(m) => {
                ghostMatRefs.current[i] = m;
              }}
              color="#9b5cff"
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
            <Edges color="#d6b3ff" />
          </mesh>
        ))}
        {/* hard-drop impact shells (expanding box cages) */}
        {Array.from({ length: IMPACT_POOL }, (_, i) => (
          <mesh key={`impact-${i}`} visible={false}>
            <boxGeometry args={[CELL, CELL, CELL]} />
            <meshBasicMaterial
              ref={(m) => {
                impactMatRefs.current[i] = m;
              }}
              color="#c98cff"
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
            <Edges color="#f0d8ff" />
          </mesh>
        ))}
      </group>
    </>
  );
});
