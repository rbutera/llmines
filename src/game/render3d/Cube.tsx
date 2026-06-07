"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
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

/** Gentle slow breathe (~0.4Hz) — NOT a strobe. Phase 2 owns real beat-reactive. */
function pulse(base: number, t: number, on: boolean): number {
  if (!on) return base;
  return base * (0.9 + 0.1 * Math.sin(t * Math.PI * 0.8));
}

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
}

export function Cube({ position, col, cols, bright, settings }: CubeProps) {
  const leftRef = useRef<THREE.MeshStandardMaterial>(null);
  const rightRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);

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
    const on = settings.beatPulse;
    if (bright) {
      const faceI = pulse(settings.brightFaceIntensity, t, on);
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      if (coreRef.current)
        coreRef.current.emissiveIntensity = pulse(
          settings.innerLightIntensity,
          t,
          on,
        );
    } else {
      const faceI = pulse(settings.darkFaceIntensity, t, on);
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      darkCoreMat.emissiveIntensity = pulse(settings.darkCoreIntensity, t, on);
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
    </group>
  );
}
