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
  /**
   * FIX 2: this is a SETTLED cell the sweep is about to clear (a completed
   * square). When true it gets the bright pulsing emissive (`settings.markedPulse`
   * on a steady fast cosine) so it reads as "about to clear", clearly distinct
   * from a calm inert settled cell. When false (and not the active piece), the
   * cell's emissive is dialled DOWN by `settings.settledEmissive` so settled
   * blocks read as inert. The active piece passes `marked={false}` and is exempt
   * from the dial-down (it uses its own breathe/heat). Default false.
   */
  marked?: boolean;
  /** Opt out of all beat/heat animation (used by the calm preview dock). */
  noBeat?: boolean;
  /**
   * Flat 2D mode (next-preview): force shear to 0 so the cell renders as a flat
   * square with no per-column shear and no 2.5D side-face reveal. Used by the
   * preview dock so upcoming pieces read as plain 2D representations, distinct
   * from the sheared board cubes. Default false (board cubes shear by column).
   */
  flat?: boolean;
}

/**
 * The per-column shear factor `kx` a cell's geometry receives. Pure, so the
 * "preview is flat" guarantee is unit-testable without R3F: in `flat` mode the
 * shear is forced to 0 for ANY column; otherwise it is `shear * colNorm`
 * (centre-relative), so off-centre board columns shear and the preview never
 * does. `cols === 1` (and the centre column) yields 0 by definition.
 */
export function shearFactor(
  shear: number,
  col: number,
  cols: number,
  flat: boolean,
): number {
  if (flat) return 0;
  const centerCol = (cols - 1) / 2;
  const colNorm = centerCol === 0 ? 0 : (col - centerCol) / centerCol;
  return shear * colNorm;
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
  marked = false,
  noBeat = false,
  flat = false,
}: CubeProps) {
  const leftRef = useRef<THREE.MeshStandardMaterial>(null);
  const rightRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);
  const gemRef = useRef<THREE.Mesh>(null);
  const gemMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const size = CELL - GAP;

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

    // The ACTIVE / falling piece is the cube wired with a heatRef. It must render
    // STEADY — no breathe, no pulse (owner flagged the active-piece pulse as
    // seizure-inducing). Pulsing is reserved EXCLUSIVELY for the to-clear/marked
    // cells (markedAdd below), so a pulse always means "this is about to clear".
    const isActivePiece = !!heatRef;

    // --- Beat-reactive breathe factor (Phase 2). GENTLE: a small smooth cosine
    // swell around 1.0, capped by beatStrength. Never a strobe (a11y). Falls
    // back to the legacy slow free-running breathe when no beat ref / disabled.
    // Skipped entirely for the active/falling piece (it stays steady) and the
    // calm preview dock (noBeat). ---
    let breathe = 1;
    if (!noBeat && !isActivePiece) {
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

    // --- Gem boost (item 4): keep this SMALL. The gem read now lives in the
    // inlaid variant-coloured marker (below), not in flooding the whole block
    // with emissive — a big boost here washed the block colour out. A faint lift
    // only, so the cell is recognisably special without losing its colour. ---
    const gemBoost = isGem && settings.gemEnabled ? settings.gemIntensity * 0.25 : 0;

    // --- FIX 2: visual hierarchy. A cube is "settled/inert" when it is neither a
    // preview (noBeat) nor the active piece (the active piece is the one wired
    // with a heatRef). Inert settled cells are dialled DOWN by settledEmissive so
    // they read as placed; a settled cell the sweep is about to clear (`marked`)
    // instead gets a bright pulse (markedPulse on a steady fast cosine) and is
    // NOT dialled down — that contrast is the primary read. The active piece and
    // previews keep their normal full emissive. ---
    const isSettled = !noBeat && !heatRef;
    const settledScale = isSettled && !marked ? settings.settledEmissive : 1;
    // To-clear pulse: a deep, fast swing (0.35..1.0 of markedPulse) so a marked
    // cell visibly THROBS — the one and only pulse in the scene, meaning "about
    // to clear". Deeper than before so the on/off read is unmistakable.
    const markedAdd =
      isSettled && marked
        ? settings.markedPulse * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 7)))
        : 0;

    if (bright) {
      const faceI =
        settings.brightFaceIntensity * breathe * settledScale +
        heat +
        gemBoost +
        markedAdd;
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      if (coreRef.current)
        coreRef.current.emissiveIntensity =
          settings.innerLightIntensity * breathe * settledScale +
          heat +
          gemBoost +
          markedAdd;
    } else {
      const faceI =
        settings.darkFaceIntensity * breathe * settledScale +
        heat +
        gemBoost +
        markedAdd;
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      darkCoreMat.emissiveIntensity =
        settings.darkCoreIntensity * breathe * settledScale + heat + markedAdd;
    }

    // Gem marker (item 4): a SUBTLE inlaid diamond that adapts to the cell. It
    // rotates gently and pulses softly — clear enough to spot, dialled down so it
    // no longer dominates or hides the block's colour underneath. Light variant
    // on bright cells, dark variant on dark cells (colour set on the material).
    if (gemRef.current && gemMatRef.current && isGem && settings.gemEnabled) {
      gemRef.current.rotation.y = t * 0.9;
      const throb = 0.5 + 0.5 * Math.sin(t * 3);
      // Small scale breathe (subtle, not a silhouette change).
      gemRef.current.scale.setScalar(1 + 0.08 * throb);
      gemMatRef.current.emissiveIntensity =
        settings.gemIntensity * (0.8 + 0.4 * throb);
    }
  });

  // Gem variant colour: LIGHT inlay on bright blocks, DARK inlay on dark blocks,
  // so the marker reads against the cell while preserving its colour identity.
  const gemColor = bright ? settings.gemLightColor : settings.gemDarkColor;

  // Per-column sheared geometry. Front face at z=0; body extends to z=-size and
  // slides in x with depth. Rebuilt only when col/size/shear change.
  const geom = useMemo(() => {
    const g = new THREE.BoxGeometry(size, size, size);
    g.translate(0, 0, -size / 2); // front -> z=0, back -> z=-size
    // FLAT 2D mode (preview): no per-column shear, so previews read as plain 2D
    // squares rather than sheared 2.5D cubes. The board path keeps its shear.
    // Single source of truth with the pure, tested `shearFactor`.
    const kx = shearFactor(settings.shear, col, cols, flat);
    // makeShear(xy, xz, yx, yz, zx, zy): zx term => x' = x + kx*z (shear X by Z).
    const m = new THREE.Matrix4().makeShear(0, 0, 0, 0, kx, 0);
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
  }, [col, cols, size, settings.shear, flat]);

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

      {/* Gem marker — special cells only (item 4). A SMALL diamond inlaid just in
          front of the cell centre, in the cell's adaptive variant colour (light
          on bright blocks, dark on dark blocks). Subtle-but-clear: it preserves
          the block's colour rather than overpowering it. Animated in useFrame. */}
      {isGem && settings.gemEnabled && (
        <mesh ref={gemRef} position={[0, 0, size * 0.42]}>
          <octahedronGeometry args={[size * 0.34, 0]} />
          <meshStandardMaterial
            ref={gemMatRef}
            color={gemColor}
            emissive={gemColor}
            emissiveIntensity={settings.gemIntensity}
            toneMapped={false}
            metalness={0.4}
            roughness={0.2}
          />
        </mesh>
      )}
    </group>
  );
}
