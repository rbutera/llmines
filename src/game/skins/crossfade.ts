/**
 * Colour crossfade between two skins.
 *
 * The skin switch ramps a `mix` scalar 0 -> 1 over ~1s; at each step the board +
 * chrome read the INTERPOLATED palette so the recolour is a smooth fade rather
 * than a hard cut. Interpolation is plain per-channel linear in sRGB hex space —
 * cheap, dependency-free, and visually fine for a UI accent fade.
 *
 * Pure functions; unit-testable without any DOM or Three.js.
 */

import type { BoardPalette, ChromePalette, Skin } from "./skins";

/** Parse a `#rrggbb` (or `#rgb`) hex into [r,g,b] 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Format [r,g,b] (rounded, clamped) back to a `#rrggbb` hex. */
export function rgbToHex(rgb: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const to2 = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${to2(rgb[0])}${to2(rgb[1])}${to2(rgb[2])}`;
}

/** Linear-interpolate two hex colours. `t=0` => `a`, `t=1` => `b`. */
export function lerpHex(a: string, b: string, t: number): string {
  const clampT = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([
    ar + (br - ar) * clampT,
    ag + (bg - ag) * clampT,
    ab + (bb - ab) * clampT,
  ]);
}

/** Interpolate every channel of two board palettes by `t`. */
export function lerpBoard(a: BoardPalette, b: BoardPalette, t: number): BoardPalette {
  return {
    background: lerpHex(a.background, b.background, t),
    darkFace: lerpHex(a.darkFace, b.darkFace, t),
    darkEmissive: lerpHex(a.darkEmissive, b.darkEmissive, t),
    darkCore: lerpHex(a.darkCore, b.darkCore, t),
    darkCoreEmissive: lerpHex(a.darkCoreEmissive, b.darkCoreEmissive, t),
    darkBack: lerpHex(a.darkBack, b.darkBack, t),
    darkEdge: lerpHex(a.darkEdge, b.darkEdge, t),
    gem: lerpHex(a.gem, b.gem, t),
  };
}

/** Interpolate every channel of two chrome palettes by `t`. */
export function lerpChrome(a: ChromePalette, b: ChromePalette, t: number): ChromePalette {
  return {
    base: lerpHex(a.base, b.base, t),
    accent: lerpHex(a.accent, b.accent, t),
    accentBright: lerpHex(a.accentBright, b.accentBright, t),
    accentDeep: lerpHex(a.accentDeep, b.accentDeep, t),
  };
}

/**
 * The blended palettes during a `from -> to` transition at progress `t`.
 * When not transitioning, pass `from === to` (or `t = 0`).
 */
export function blendSkins(
  from: Skin,
  to: Skin,
  t: number,
): { board: BoardPalette; chrome: ChromePalette } {
  return {
    board: lerpBoard(from.board, to.board, t),
    chrome: lerpChrome(from.chrome, to.chrome, t),
  };
}

/** The chrome palette as a CSS-custom-property map for inline `style`. */
export function chromeCssVars(c: ChromePalette): Record<string, string> {
  return {
    "--accent": c.accent,
    "--accent-bright": c.accentBright,
    "--accent-deep": c.accentDeep,
    "--base": c.base,
  };
}
