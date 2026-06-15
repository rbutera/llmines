"use client";

import { type RefObject, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";
import { beatBreathe } from "../fx/beatFx";
import type { VisualSettings } from "./settings";
import { CELL, GAP } from "./layout";
import { type BoardPalette, SKIN_NEON } from "../skins/skins";
import { cellShapeForSkin } from "./cellShapes";

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
  /**
   * The active skin's board palette — drives the dark-cell colours + the
   * dark-block gem accent so the board recolours when the skin switches. Defaults
   * to the neon (skin 1) palette so existing callers/tests are unaffected.
   */
  palette?: BoardPalette;
  /**
   * The active skin id — selects the per-cell SHAPE motif (see cellShapes.ts):
   * skin 1 = glowing orb / inner X; skin 2 = faceted diamond / hollow ring. So
   * the two skins read as visually distinct WORLDS, not just a recolour. Defaults
   * to the neon (skin 1) orb/X motif so existing callers/tests are unaffected.
   */
  skinId?: string;
  /**
   * Preview-dock mode: render the cell so its TRUE colour reads unmistakably even
   * without the board's bloom + beat emphasis. A bright (colour-0) cell on the
   * board pops via bloom; in the calm flat preview the same cell would otherwise
   * sit as a faint translucent box and could be misread as the DARK colour (the
   * "preview colours look inverted" report). In preview mode the bright inner
   * shape is driven brighter and the glass box made less transparent, so colour-0
   * always reads light and colour-1 dark — faithful to the piece that spawns.
   * Default false.
   */
  preview?: boolean;
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
  palette = SKIN_NEON.board,
  skinId = SKIN_NEON.id,
  preview = false,
}: CubeProps) {
  const motif = cellShapeForSkin(skinId);
  const leftRef = useRef<THREE.MeshStandardMaterial>(null);
  const rightRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreRef = useRef<THREE.MeshStandardMaterial>(null);
  const gemRef = useRef<THREE.Mesh>(null);
  const gemMatRef = useRef<THREE.MeshStandardMaterial>(null);
  // Skin-2 inner-shape refs: the faceted bright DIAMOND (gently rotates) + its
  // material (shares the bright emissive envelope with the orb path), and the
  // dark RING material (shares the dark-core envelope with the inner-X bars).
  const diamondRef = useRef<THREE.Mesh>(null);

  const size = CELL - GAP;

  // Dark-cell inner-X material (shared by both crossed bars). Muted by design.
  // Rebuilt when the skin palette's dark-core colours change (skin switch); the
  // emissive INTENSITY is still updated live in useFrame.
  const darkCoreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.darkCore,
        emissive: palette.darkCoreEmissive,
        emissiveIntensity: settings.darkCoreIntensity,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette.darkCore, palette.darkCoreEmissive],
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

    // Preview cells render without the board's bloom + beat lift, so a bright
    // (colour-0) cell would otherwise read faint and could be mistaken for the
    // DARK colour. Lift the bright inner-shape + side-face emissive in preview so
    // colour-0 unmistakably reads light (FIX A: "preview colours look inverted").
    const previewFaceBoost = preview ? 0.55 : 0;
    const previewCoreBoost = preview ? 0.9 : 0;

    if (bright) {
      const faceI =
        settings.brightFaceIntensity * breathe * settledScale +
        heat +
        gemBoost +
        markedAdd +
        previewFaceBoost;
      if (leftRef.current) leftRef.current.emissiveIntensity = faceI;
      if (rightRef.current) rightRef.current.emissiveIntensity = faceI;
      // The bright inner SHAPE (orb on skin 1, diamond on skin 2) shares this
      // emissive envelope via coreRef, so swapping the mesh keeps the lighting.
      if (coreRef.current)
        coreRef.current.emissiveIntensity =
          settings.innerLightIntensity * breathe * settledScale +
          heat +
          gemBoost +
          markedAdd +
          previewCoreBoost;
      // Skin-2 diamond: a slow facet rotation so it reads as a gem, not a blob.
      if (diamondRef.current) diamondRef.current.rotation.y = t * 0.6;
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

  // Gem variant colour (P0, round-2 tuned for visibility): MAGENTA inlay on
  // bright blocks, GOLD inlay on dark blocks — high contrast against either cell.
  // v2.5 keeps this on the round-2 settings scheme across BOTH skins (P0 wins
  // over per-skin gem recolour) so the chain-special marker stays consistently
  // readable; the skin recolours the cells/edges/background/chrome around it.
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

  // FIX A: in the preview, make the bright cell's glass body LESS transparent so
  // colour-0 reads as a solid light block rather than a near-empty frame (which
  // looked like the dark colour, the "inverted preview" report). On the board the
  // translucent glass is kept (bloom + the orb carry the bright read there).
  const glassOpacity = preview
    ? Math.min(1, settings.glassOpacity + 0.45)
    : settings.glassOpacity;

  return (
    <group position={position}>
      <mesh geometry={geom}>
        {bright ? (
          <>
            {/* [0] +x right — illuminating bright side face (palette-driven) */}
            <meshStandardMaterial
              ref={rightRef}
              attach="material-0"
              color={palette.brightFace}
              emissive={palette.brightFace}
              emissiveIntensity={settings.brightFaceIntensity}
              toneMapped={false}
              metalness={0.2}
              roughness={0.3}
            />
            {/* [1] -x left — illuminating bright side face (palette-driven) */}
            <meshStandardMaterial
              ref={leftRef}
              attach="material-1"
              color={palette.brightFace}
              emissive={palette.brightFace}
              emissiveIntensity={settings.brightFaceIntensity}
              toneMapped={false}
              metalness={0.2}
              roughness={0.3}
            />
            {/* [2] +y top — glassy/transparent */}
            <meshStandardMaterial
              attach="material-2"
              color={palette.brightGlass}
              transparent
              opacity={glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
            {/* [3] -y bottom — glassy/transparent */}
            <meshStandardMaterial
              attach="material-3"
              color={palette.brightGlass}
              transparent
              opacity={glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
            {/* [4] +z front — glassy/transparent */}
            <meshStandardMaterial
              attach="material-4"
              color={palette.brightGlass}
              transparent
              opacity={glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.12}
            />
            {/* [5] -z back — glassy/transparent */}
            <meshStandardMaterial
              attach="material-5"
              color={palette.brightGlass}
              transparent
              opacity={glassOpacity}
              depthWrite={false}
              metalness={0.6}
              roughness={0.15}
            />
          </>
        ) : (
          <>
            {/* [0] +x right — mildly emissive accent, dim */}
            <meshStandardMaterial
              ref={rightRef}
              attach="material-0"
              color={palette.darkFace}
              emissive={palette.darkEmissive}
              emissiveIntensity={settings.darkFaceIntensity}
              metalness={0.1}
              roughness={0.6}
            />
            {/* [1] -x left — mildly emissive accent, dim */}
            <meshStandardMaterial
              ref={leftRef}
              attach="material-1"
              color={palette.darkFace}
              emissive={palette.darkEmissive}
              emissiveIntensity={settings.darkFaceIntensity}
              metalness={0.1}
              roughness={0.6}
            />
            {/* [2] +y top — transparent */}
            <meshStandardMaterial
              attach="material-2"
              color={palette.darkFace}
              transparent
              opacity={0.12}
              depthWrite={false}
              metalness={0.1}
              roughness={0.7}
            />
            {/* [3] -y bottom — dark semi-opaque accent */}
            <meshStandardMaterial
              attach="material-3"
              color={palette.darkFace}
              transparent
              opacity={0.85}
              depthWrite={false}
              metalness={0.1}
              roughness={0.7}
            />
            {/* [4] +z front — dark semi-opaque accent */}
            <meshStandardMaterial
              attach="material-4"
              color={palette.darkFace}
              transparent
              opacity={0.85}
              depthWrite={false}
              metalness={0.1}
              roughness={0.65}
            />
            {/* [5] -z back — deep night-sky accent */}
            <meshStandardMaterial
              attach="material-5"
              color={palette.darkBack}
              metalness={0.05}
              roughness={0.9}
            />
          </>
        )}
        {/* Glowing edge frame — hero element. White on bright (blooms), dim
            accent on dark. Child of the mesh so it follows the shear. */}
        <Edges color={bright ? palette.brightEdge : palette.darkEdge} />
      </mesh>

      {/* Bright inner shape — skin 1 = glowing ORB (sphere); skin 2 = faceted
          DIAMOND (octahedron, slowly rotating in useFrame). Both share `coreRef`
          so the emissive breathe/heat/preview-boost envelope drives either one. */}
      {bright && motif.bright === "orb" && (
        <mesh position={[0, 0, -size / 2]}>
          <sphereGeometry args={[coreR, 20, 20]} />
          <meshStandardMaterial
            ref={coreRef}
            color={palette.brightCore}
            emissive={palette.brightCore}
            emissiveIntensity={settings.innerLightIntensity}
            toneMapped={false}
          />
        </mesh>
      )}
      {bright && motif.bright === "diamond" && (
        <mesh ref={diamondRef} position={[0, 0, -size / 2]}>
          <octahedronGeometry args={[size * 0.42, 0]} />
          <meshStandardMaterial
            ref={coreRef}
            color={palette.brightCore}
            emissive={palette.brightCore}
            emissiveIntensity={settings.innerLightIntensity}
            toneMapped={false}
            metalness={0.45}
            roughness={0.18}
          />
        </mesh>
      )}

      {/* Dark inner shape — skin 1 = inner X (two crossed bars); skin 2 = a hollow
          RING (torus). Both use `darkCoreMat` so the dark-core emissive envelope
          is shared. The ring's flat silhouette reads clearly distinct from the X. */}
      {!bright && motif.dark === "x" && (
        <group position={[0, 0, -size / 2]}>
          <mesh material={darkCoreMat} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[size * 0.6, size * 0.12, size * 0.12]} />
          </mesh>
          <mesh material={darkCoreMat} rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[size * 0.6, size * 0.12, size * 0.12]} />
          </mesh>
        </group>
      )}
      {!bright && motif.dark === "ring" && (
        <mesh material={darkCoreMat} position={[0, 0, -size / 2]}>
          <torusGeometry args={[size * 0.26, size * 0.075, 12, 28]} />
        </mesh>
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
