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
 * This is built from BOXES, not camera-facing planes, so it carries genuine 3D
 * volume from this camera the same way the board cubes do (a box has depth +
 * edges; a plane facing the camera is a flat decal). Three parts:
 *
 *  1. ENERGY SHELL (continuous) — a translucent additive box hull, slightly
 *     larger than the 2x2 piece, riding the active-piece group so it wraps the
 *     falling block. Its opacity + how far it bulges scales with the shared drop
 *     ENERGY (soft-drop trail / heat). At rest it is invisible; as the piece
 *     drops faster the cage brightens and its glowing edges flare. This is the
 *     "speed-distortion field" around the block.
 *
 *  2. AFTER-IMAGES (trail) — a small POOL of ghost box hulls. While the piece
 *     descends with energy, we periodically STAMP a ghost at the piece's current
 *     world position; each ghost then fades + shrinks in place over ~0.25s. Left
 *     in true world space, they string UP the column the piece fell through with
 *     real depth + overlap — a 3D motion trail, not an upward plane.
 *
 *  3. IMPACT SHELL (hard-drop burst) — on a hard-drop landing, a box hull snaps
 *     to the piece footprint at the landing row then EXPANDS outward + fades over
 *     ~0.3s: an expanding 3D shock cage. Pairs with the (kept) screen-shake +
 *     spark burst for a landing that punches.
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
  // Continuous shell (child of THIS group; the caller nests it under the active
  // piece group so it follows the block).
  const shellRef = useRef<THREE.Group>(null);
  const shellMatRef = useRef<THREE.MeshBasicMaterial>(null);

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

  useFrame((_s, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    const energy = Math.max(0, Math.min(1, energyRef.current ?? 0));

    // --- 1. Continuous energy shell: world-positioned over the live piece. ---
    // Positioned in WORLD space (not nested under the piece group) so this single
    // component can own the shell AND the world-space trail/impacts. The shell
    // tracks the piece via activeWorldRef; it hides when no piece / no energy.
    const shell = shellRef.current;
    const shellMat = shellMatRef.current;
    const world = activeWorldRef.current;
    if (shell && shellMat) {
      const on = !!world && energy > 0.02;
      shell.visible = on;
      if (on && world) {
        shell.position.set(world.x, world.y, CELL * 0.1);
        // Bulge a little with speed so the cage visibly distends — a "force field"
        // squeezing the block, not a static box.
        const bulge = 1 + energy * 0.18;
        shell.scale.set(bulge, bulge, 1 + energy * 0.5);
        shellMat.opacity = Math.min(0.5, energy * 0.42 * Math.max(0.5, intensity));
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
      {/* Continuous energy shell — world-positioned each frame over the live
          piece (so this one component owns the shell + the world trail). */}
      <group ref={shellRef} visible={false}>
        <mesh>
          <boxGeometry args={[shellW, shellH, shellD]} />
          <meshBasicMaterial
            ref={shellMatRef}
            color="#b06bff"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
          {/* Glowing cage edges — this is what makes the hull read as a 3D cage. */}
          <Edges color="#e0b8ff" />
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
