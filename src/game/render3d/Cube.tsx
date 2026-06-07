"use client";

import { type RefObject, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { beatBreathe } from "../fx/beatFx";
import type { VisualSettings } from "./settings";
import { CELL, GAP } from "./layout";

/**
 * A single board cell rendered as a sheared 3D cube — the "Lumines Arise" 2.5D
 * look ported verbatim from the standalone sandbox (`~/dev/llmines-3d-sandbox`),
 * which Rai validated and tuned.
 *
 * BRIGHT cells (block colour A / index 0) = glassy translucent body + emissive
 * near-white side faces + an inner emissive orb. DARK cells (block colour B /
 * index 1) = night-sky purple box + dim purple side faces + an inner muted X.
 * The mapping from the game's two block colours to bright/dark lives in Scene3D.
 *
 * The shear is per-column: front face stays square & flush in its cell (z=0);
 * the body slides in x with depth so the revealed side face overhangs the
 * neighbour, faking the curve. makeShear ZX term (shear X by Z) — the XZ term is
 * invisible under an ortho camera (the sandbox's documented gotcha).
 */

export interface CubeProps {
  /** Centred world position of the cell's cube group. */
  position: [number, number, number];
  /** Column index — drives the per-column shear sign + magnitude. */
  col: number;
  /** Total columns — for the centre-relative shear normalisation. */
  cols: number;
  /** Bright (glass crystal + orb) vs dark (night box + X). */
  bright: boolean;
  settings: VisualSettings;
  /**
   * Phase-2: shared beat-phase ref (0..1 from sweepX/bpm). When present AND
   * `settings.beatReactive`, the emissive GENTLY breathes on the beat (a smooth,
   * small cosine swell — never a strobe). Absent => falls back to the slow
   * free-running breathe gated by the legacy `beatPulse` toggle.
   */
  beatPhaseRef?: RefObject<number>;
  /**
   * Phase-2 heat glow: shared 0..1 heat ref (active descending piece only). When
   * present, adds `heat * settings.heatIntensity` extra emissive on the piece so
   * a fast soft-drop visibly heats up. Glow lives ON the piece, not centre-screen.
   */
  heatRef?: RefObject<number>;
  /** Phase-2 gem: this cell carries a chain special — give it a distinct read. */
  isGem?: boolean;
  /** Opt out of all beat/heat animation (used by the calm preview dock). */
  noBeat?: boolean;
}

export function Cube({
  position,
  col,
  cols,
  bright,
  settings,
  beatPhaseRef,
  heatRef,
  isGem = false,
  noBeat = false,
}: CubeProps) {
  const leftRef = useRef<THREE.MeshStandardMaterial>(null);
  const rightRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);
  const gemRef = useRef<THREE.Mesh>(null);
  const gemMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const size = CELL - GAP;
  const centerCol = (cols - 1) / 2;

  // Dark-cell inner-X material (shared by both crossed bars). Muted by design.
  const darkCoreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2a1147",
        emissive: "#7c3aed",
        emissiveIntensity: settings.darkCoreIntensity,
        toneMapped: false,
      }),
    // Created once; emissive intensity is updated live in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((s) => {
    const t = s.clock.elapsedTime;

    // --- Beat-reactive breathe factor (Phase 2). GENTLE: a small smooth cosine
    // swell around 1.0, capped by beatStrength. Never a strobe (a11y). Falls
    // back to the legacy slow free-running breathe when no beat ref / disabled. ---
    let breathe = 1;
    if (!noBeat) {
      if (beatPhaseRef && settings.beatReactive) {
        breathe = beatBreathe(beatPhaseRef.current ?? 0, settings.beatStrength, true);
      } else if (settings.beatPulse) {
        breathe = 0.9 + 0.1 * Math.sin(t * Math.PI * 0.8);
      }
    }

    // --- Heat glow (Phase 2): extra additive emissive on a fast-dropping piece. ---
    const heat =
      !noBeat && heatRef && settings.heatEnabled
        ? (heatRef.current ?? 0) * settings.heatIntensity
        : 0;

    // --- Gem boost (Phase 2): special cells read brighter + pulse a marker. ---
    const gemBoost = isGem && settings.gemEnabled ? settings.gemIntensity : 0;

    if (bright) {
      const faceI = settings.brightFaceIntensity * breathe + heat + gemBoost;
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      if (coreRef.current)
        coreRef.current.emissiveIntensity =
          settings.innerLightIntensity * breathe + heat + gemBoost;
    } else {
      const faceI = settings.darkFaceIntensity * breathe + heat + gemBoost;
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      darkCoreMat.emissiveIntensity = settings.darkCoreIntensity * breathe + heat;
    }

    // Gem marker: a small pulsing octahedron that spins + breathes so a special
    // reads instantly even at a glance. Uses its own steady pulse (not the beat)
    // so it stands out against the calmer board.
    if (gemRef.current && gemMatRef.current && isGem && settings.gemEnabled) {
      gemRef.current.rotation.y = t * 1.6;
      gemRef.current.rotation.x = t * 0.9;
      gemMatRef.current.emissiveIntensity =
        settings.gemIntensity * (1.1 + 0.5 * Math.sin(t * 4));
    }
  });

  // Per-column sheared geometry. Front face at z=0; body extends to z=-size and
  // slides in x with depth. Rebuilt only when col/size/shear change.
  const geom = useMemo(() => {
    const g = new THREE.BoxGeometry(size, size, size);
    g.translate(0, 0, -size / 2); // front -> z=0, back -> z=-size
    const colNorm = centerCol === 0 ? 0 : (col - centerCol) / centerCol; // -1..1
    const kx = settings.shear * colNorm;
    // makeShear(xy, xz, yx, yz, zx, zy): zx term => x' = x + kx*z (shear X by Z).
    const m = new THREE.Matrix4().makeShear(0, 0, 0, 0, kx, 0);
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
  }, [col, centerCol, size, settings.shear]);

  // Dispose the geometry when it is replaced or the cube unmounts (per-cell
  // BoxGeometry is not auto-disposed by R3F when we pass our own geometry).
  const prevGeom = useRef<THREE.BufferGeometry | null>(null);
  if (prevGeom.current && prevGeom.current !== geom) {
    prevGeom.current.dispose();
  }
  prevGeom.current = geom;

  const coreR = size * 0.3;

  return (
    <group position={position}>
      <mesh geometry={geom}>
        {bright ? (
          <>
            {/* [0] +x right — illuminating near-white side face */}
            <meshStandardMaterial
              ref={rightRef}
              attach="material-0"
              color="#eaf6ff"
              emissive="#eaf6ff"
              emissiveIntensity={settings.brightFaceIntensity}
              toneMapped={false}
              metalness={0.2}
              roughness={0.3}
            />
            {/* [1] -x left — illuminating near-white side face */}
            <meshStandardMaterial
              ref={leftRef}
              attach="material-1"
              color="#eaf6ff"
              emissive="#eaf6ff"
              emissiveIntensity={settings.brightFaceIntensity}
              toneMapped={false}
              metalness={0.2}
              roughness={0.3}
            />
            {/* [2] +y top — glassy/transparent */}
            <meshStandardMaterial
              attach="material-2"
              color="#cdeafe"
              transparent
              opacity={settings.glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
            {/* [3] -y bottom — glassy/transparent */}
            <meshStandardMaterial
              attach="material-3"
              color="#cdeafe"
              transparent
              opacity={settings.glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
            {/* [4] +z front — glassy/transparent */}
            <meshStandardMaterial
              attach="material-4"
              color="#d6f0ff"
              transparent
              opacity={settings.glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.12}
            />
            {/* [5] -z back — glassy/transparent */}
            <meshStandardMaterial
              attach="material-5"
              color="#cdeafe"
              transparent
              opacity={settings.glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
          </>
        ) : (
          <>
            {/* [0] +x right — mildly emissive purple, dim */}
            <meshStandardMaterial
              ref={rightRef}
              attach="material-0"
              color="#1a0e33"
              emissive="#3b1d6e"
              emissiveIntensity={settings.darkFaceIntensity}
              metalness={0.1}
              roughness={0.6}
            />
            {/* [1] -x left — mildly emissive purple, dim */}
            <meshStandardMaterial
              ref={leftRef}
              attach="material-1"
              color="#1a0e33"
              emissive="#3b1d6e"
              emissiveIntensity={settings.darkFaceIntensity}
              metalness={0.1}
              roughness={0.6}
            />
            {/* [2] +y top — transparent */}
            <meshStandardMaterial
              attach="material-2"
              color="#1a0e33"
              transparent
              opacity={0.12}
              depthWrite={false}
              metalness={0.1}
              roughness={0.7}
            />
            {/* [3] -y bottom — dark semi-opaque purple */}
            <meshStandardMaterial
              attach="material-3"
              color="#1a0e33"
              transparent
              opacity={0.85}
              depthWrite={false}
              metalness={0.1}
              roughness={0.7}
            />
            {/* [4] +z front — dark semi-opaque purple */}
            <meshStandardMaterial
              attach="material-4"
              color="#1a0e33"
              transparent
              opacity={0.85}
              depthWrite={false}
              metalness={0.1}
              roughness={0.65}
            />
            {/* [5] -z back — deep night-sky purple */}
            <meshStandardMaterial
              attach="material-5"
              color="#150a2e"
              metalness={0.05}
              roughness={0.9}
            />
          </>
        )}
        {/* Glowing edge frame — hero element. White on bright (blooms), dim
            purple on dark. Child of the mesh so it follows the shear. */}
        <Edges color={bright ? "#ffffff" : "#6b4a9e"} />
      </mesh>

      {/* Inner light orb — bright cells only. Axis-aligned, cell centre. */}
      {bright && (
        <mesh position={[0, 0, -size / 2]}>
          <sphereGeometry args={[coreR, 20, 20]} />
          <meshStandardMaterial
            ref={coreRef}
            color="#f4fbff"
            emissive="#f4fbff"
            emissiveIntensity={settings.innerLightIntensity}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Inner X — dark cells only. Two crossed thin bars at the cell centre. */}
      {!bright && (
        <group position={[0, 0, -size / 2]}>
          <mesh material={darkCoreMat} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[size * 0.6, size * 0.12, size * 0.12]} />
          </mesh>
          <mesh material={darkCoreMat} rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[size * 0.6, size * 0.12, size * 0.12]} />
          </mesh>
        </group>
      )}

      {/* Gem marker — special cells only. A small spinning, pulsing octahedron
          floating slightly in front of the cell so a special reads instantly
          (distinct silhouette from the square blocks). Animated in useFrame. */}
      {isGem && settings.gemEnabled && (
        <mesh ref={gemRef} position={[0, 0, size * 0.25]}>
          <octahedronGeometry args={[size * 0.26, 0]} />
          <meshStandardMaterial
            ref={gemMatRef}
            color="#fff0b0"
            emissive="#ffd24a"
            emissiveIntensity={settings.gemIntensity}
            toneMapped={false}
            metalness={0.3}
            roughness={0.2}
          />
        </mesh>
      )}
    </group>
  );
}
