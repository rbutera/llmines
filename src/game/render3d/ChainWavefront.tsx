"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL } from "./layout";
import type { SurgeStyle } from "./surgeStyles";

/**
 * Gem-clear CASCADE (PART 1). When a chain gem clears a connected same-colour
 * component, the clear does not blink — it IGNITES at the gem, then a white-hot
 * leading edge SURGES outward along the H/V graph by BFS distance, each cell
 * super-saturating + blooming the instant the front reaches it, doing a fast
 * scale-pop + emissive spike (a "shatter") before dissolving, and the furthest
 * cell triggers a CLIMAX: a global bloom-swell + an expanding shockwave ring.
 *
 * The animation is strictly cosmetic. Scene3D seeds it from the core's RECORD-
 * ONLY `lastChainClear` payload (origin + each cleared cell tagged with its BFS
 * distance from the origin). Distance becomes a per-cell START DELAY
 * (`ignite + dist * msPerRing`) so the front travels one ring per `msPerRing`.
 * The deterministic core clock stays the source of truth for gameplay; this rides
 * the render clock.
 *
 * BIG-CLEAR SAFETY (crown-jewel constraint): a 50/70+ cell gem must read HUGE,
 * not tank the frame. Every cleared cell ALWAYS gets a flash slot (we never cap
 * the visible clear), but the flash pool is fixed-size and round-robins; the
 * caller (Scene3D) degrades *particle* density for big clears, never coverage.
 * The climax (shockwave radius + global swell) scales UP with size so a bigger
 * gem reach feels bigger — the payoff, not a problem to clamp away.
 *
 * Two fixed-size pools, no per-event allocation: additive flash quads (one
 * instanced draw) + a small ring of shockwave quads. Idle slots park off-screen.
 */

/** Per-cell seed: world position + BFS distance + this cell's own colour tint. */
export interface CascadeCell {
  position: [number, number, number];
  dist: number;
  /** The cell's own colour as an RGB triple (0..1), for the trailing corona. */
  colour: readonly [number, number, number];
}

export interface CascadeSeed {
  cells: CascadeCell[];
  /** Origin gem world position (drives the ignite charge + shockwave centre). */
  origin: [number, number, number];
  /** ms per BFS-distance ring (surge speed). */
  msPerRing: number;
  /** Peak flash brightness multiplier. */
  intensity: number;
  /** Per-skin surge palette (core / corona / shockwave colours). */
  style: SurgeStyle;
  /** Whether to spawn the climax shockwave ring. */
  shockwave: boolean;
}

export interface ChainWavefrontHandle {
  /** Seed a full cascade. */
  seed: (seed: CascadeSeed) => void;
  /**
   * Live 0..1 "climax energy" the host can read to swell global bloom: rises as
   * the furthest cells clear and decays after. Pure render signal.
   */
  climaxRef: React.RefObject<number>;
}

const MAX_FLASHES = 512; // ceiling across all simultaneous cascades (big clears)
const MAX_SHOCKS = 8; // concurrent shockwave rings
const IGNITE = 0.08; // seconds: anticipation charge at the gem before release
const RISE = 0.05; // seconds: ramp to the white-hot peak when a cell lights
const FADE = 0.22; // seconds: super-saturated peak -> dissolve
const SHOCK_LIFE = 0.55; // seconds: shockwave ring expand + fade

export const ChainWavefront = forwardRef<ChainWavefrontHandle>(
  function ChainWavefront(_props, ref) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const shockRef = useRef<THREE.InstancedMesh>(null);
    const climaxRef = useRef<number>(0);

    // Per-slot flash state (struct-of-arrays, written in place each frame).
    const fx = useMemo(() => {
      const delay = new Float32Array(MAX_FLASHES); // s until this cell lights
      const elapsed = new Float32Array(MAX_FLASHES); // s since seeded
      const total = new Float32Array(MAX_FLASHES); // lifetime (0 = idle)
      const peak = new Float32Array(MAX_FLASHES); // intensity scale
      const px = new Float32Array(MAX_FLASHES);
      const py = new Float32Array(MAX_FLASHES);
      const pz = new Float32Array(MAX_FLASHES);
      // trailing corona colour per slot (the cell's own colour, super-saturated)
      const cr = new Float32Array(MAX_FLASHES);
      const cg = new Float32Array(MAX_FLASHES);
      const cb = new Float32Array(MAX_FLASHES);
      // white-hot core colour per slot (from the skin surge style)
      const kr = new Float32Array(MAX_FLASHES);
      const kg = new Float32Array(MAX_FLASHES);
      const kb = new Float32Array(MAX_FLASHES);
      return { delay, elapsed, total, peak, px, py, pz, cr, cg, cb, kr, kg, kb };
    }, []);

    // Shockwave ring state.
    const sw = useMemo(() => {
      const elapsed = new Float32Array(MAX_SHOCKS);
      const total = new Float32Array(MAX_SHOCKS); // 0 = idle
      const maxR = new Float32Array(MAX_SHOCKS); // peak radius (world units)
      const px = new Float32Array(MAX_SHOCKS);
      const py = new Float32Array(MAX_SHOCKS);
      const pz = new Float32Array(MAX_SHOCKS);
      const r = new Float32Array(MAX_SHOCKS); // colour
      const g = new Float32Array(MAX_SHOCKS);
      const b = new Float32Array(MAX_SHOCKS);
      return { elapsed, total, maxR, px, py, pz, r, g, b };
    }, []);

    const nextSlot = useRef(0);
    const nextShock = useRef(0);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const color = useMemo(() => new THREE.Color(), []);

    useImperativeHandle(
      ref,
      (): ChainWavefrontHandle => ({
        climaxRef,
        seed(s) {
          if (s.cells.length === 0) return;
          const ring = Math.max(0, s.msPerRing) / 1000; // seconds per dist ring
          let maxDist = 0;
          for (const c of s.cells) {
            const i = nextSlot.current;
            nextSlot.current = (nextSlot.current + 1) % MAX_FLASHES;
            // IGNITE: dist-0 origin charges first; the surge releases after the
            // ignite window so the origin reads as winding up then bursting.
            fx.delay[i] = IGNITE + c.dist * ring;
            fx.elapsed[i] = 0;
            fx.total[i] = IGNITE + c.dist * ring + RISE + FADE;
            fx.peak[i] = s.intensity;
            fx.px[i] = c.position[0];
            fx.py[i] = c.position[1];
            fx.pz[i] = c.position[2] + CELL * 0.06;
            // super-saturate the cell's own colour for the trailing corona
            fx.cr[i] = c.colour[0];
            fx.cg[i] = c.colour[1];
            fx.cb[i] = c.colour[2];
            fx.kr[i] = s.style.core[0];
            fx.kg[i] = s.style.core[1];
            fx.kb[i] = s.style.core[2];
            if (c.dist > maxDist) maxDist = c.dist;
          }

          // CLIMAX shockwave: fire when the furthest cell would clear. Scale the
          // peak radius + the global swell with the component reach so a big gem
          // feels huge. Delayed to coincide with the furthest cell's shatter.
          if (s.shockwave) {
            const i = nextShock.current;
            nextShock.current = (nextShock.current + 1) % MAX_SHOCKS;
            // radius grows with reach but is capped so it never exceeds the well
            // by an absurd amount (still clearly bigger for bigger clears).
            const reach = Math.min(maxDist, 14);
            sw.elapsed[i] = -(IGNITE + maxDist * ring); // negative => waits
            sw.total[i] = SHOCK_LIFE;
            sw.maxR[i] = CELL * (3 + reach * 1.6);
            sw.px[i] = s.origin[0];
            sw.py[i] = s.origin[1];
            sw.pz[i] = s.origin[2] + CELL * 0.04;
            sw.r[i] = s.style.shock[0];
            sw.g[i] = s.style.shock[1];
            sw.b[i] = s.style.shock[2];
          }
          // Stage a global bloom-swell sized by the clear (read by the host).
          // Bigger reach => bigger swell; capped at 1.
          climaxRef.current = Math.min(
            1,
            climaxRef.current + 0.4 + Math.min(0.6, maxDist * 0.06),
          );
        },
      }),
      [fx, sw],
    );

    useFrame((_s, dt) => {
      const mesh = meshRef.current;
      const shock = shockRef.current;
      if (!mesh || !shock) return;
      const clampedDt = Math.min(dt, 0.05);

      // --- Flash quads: ignite -> surge -> shatter -> dissolve, per slot. ---
      for (let i = 0; i < MAX_FLASHES; i++) {
        const total = fx.total[i]!;
        if (total <= 0) {
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        const e = fx.elapsed[i]! + clampedDt;
        fx.elapsed[i] = e;
        if (e >= total) {
          fx.total[i] = 0;
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        const delay = fx.delay[i]!;
        const since = e - delay;
        // Brightness envelope: 0 before the front arrives, fast RISE to a
        // white-hot peak, then a longer super-saturated FADE (the shatter glow).
        let level: number;
        let hot: number; // 0..1 "how white-hot" — peaks at the leading edge
        if (since <= 0) {
          // IGNITE anticipation: the origin (dist 0) charges before release.
          // Only dist-0 cells are in this window (others arrive later); give a
          // faint inward pre-glow so the gem reads as winding up.
          const charge = Math.max(0, 1 + since / IGNITE); // 0..1 across ignite
          level = charge * 0.35;
          hot = charge;
          // a slight inward PULL: scale dips below 1 as it charges
          const pull = 0.85 + 0.15 * (1 - charge);
          const sc = (CELL - 0.06) * pull * (0.4 + 0.4 * level);
          dummy.position.set(fx.px[i]!, fx.py[i]!, fx.pz[i]!);
          dummy.scale.setScalar(level <= 0.001 ? 0.0001 : sc);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const b = level * fx.peak[i]!;
          mesh.setColorAt(
            i,
            color.setRGB(b * fx.kr[i]!, b * fx.kg[i]!, b * fx.kb[i]!),
          );
          continue;
        } else if (since < RISE) {
          level = since / RISE;
          hot = 1; // white-hot at the leading edge
        } else {
          const f = (since - RISE) / FADE; // 0..1 over the fade
          level = Math.max(0, 1 - f * f); // ease-out (lingers bright then drops)
          hot = Math.max(0, 1 - f * 2.2); // cools to the corona colour fast
        }
        const peak = fx.peak[i]!;
        const b = level * peak;
        // Scale-pop: snaps up past 1 at the leading edge then settles as it fades
        // (the per-cell "shatter" pop).
        const pop = 0.6 + 1.05 * level + 0.35 * hot;
        const scale = (CELL - 0.06) * pop;
        dummy.position.set(fx.px[i]!, fx.py[i]!, fx.pz[i]!);
        dummy.scale.setScalar(level <= 0.001 ? 0.0001 : scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Colour = white-hot core lerped toward the cell's own corona as it
        // cools, both super-saturated and additive so it blooms.
        const r = (fx.kr[i]! * hot + fx.cr[i]! * (1 - hot)) * b;
        const g = (fx.kg[i]! * hot + fx.cg[i]! * (1 - hot)) * b;
        const bl = (fx.kb[i]! * hot + fx.cb[i]! * (1 - hot)) * b;
        mesh.setColorAt(i, color.setRGB(r, g, bl));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // --- Shockwave rings: expand + fade. ---
      for (let i = 0; i < MAX_SHOCKS; i++) {
        const total = sw.total[i]!;
        if (total <= 0) {
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          shock.setMatrixAt(i, dummy.matrix);
          shock.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        const e = sw.elapsed[i]! + clampedDt;
        sw.elapsed[i] = e;
        if (e <= 0) {
          // still waiting for the furthest cell to clear; park it.
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          shock.setMatrixAt(i, dummy.matrix);
          shock.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        if (e >= total) {
          sw.total[i] = 0;
          dummy.position.set(0, 0, -9999);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          shock.setMatrixAt(i, dummy.matrix);
          shock.setColorAt(i, color.setRGB(0, 0, 0));
          continue;
        }
        const f = e / total; // 0..1
        // ease-out expansion; the ring is a flat textured-less quad scaled up,
        // brightness falls as it grows so it reads as a pressure wave.
        const radius = sw.maxR[i]! * (1 - (1 - f) * (1 - f));
        const bright = (1 - f) * 1.6;
        dummy.position.set(sw.px[i]!, sw.py[i]!, sw.pz[i]!);
        dummy.scale.setScalar(Math.max(0.0001, radius));
        dummy.updateMatrix();
        shock.setMatrixAt(i, dummy.matrix);
        shock.setColorAt(
          i,
          color.setRGB(sw.r[i]! * bright, sw.g[i]! * bright, sw.b[i]! * bright),
        );
      }
      shock.instanceMatrix.needsUpdate = true;
      if (shock.instanceColor) shock.instanceColor.needsUpdate = true;

      // Decay the global climax swell so the host's bloom breathes back down.
      climaxRef.current *= Math.max(0, 1 - clampedDt * 3.0);
    });

    return (
      <>
        {/* Flash quads — additive, super-saturated; one instanced draw. */}
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, MAX_FLASHES]}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            transparent
            opacity={0.95}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            vertexColors
          />
        </instancedMesh>

        {/* Shockwave rings — additive ring geometry, scaled per slot. */}
        <instancedMesh
          ref={shockRef}
          args={[undefined, undefined, MAX_SHOCKS]}
          frustumCulled={false}
        >
          <ringGeometry args={[0.82, 1, 48]} />
          <meshBasicMaterial
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            vertexColors
          />
        </instancedMesh>
      </>
    );
  },
);
