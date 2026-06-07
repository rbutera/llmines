/**
 * Visual settings for the Three.js / R3F renderer (Phase 1).
 *
 * These are the tunables Rai dialled in against the standalone sandbox
 * (`~/dev/llmines-3d-sandbox`) on 2026-06-07 — they are the BAKED DEFAULTS.
 * The in-app leva panel reads/writes these and persists every change to
 * localStorage, so a reload restores the last-tuned look (no manual re-dialling
 * — the Brita-filter shape: the system remembers, not the human).
 *
 * Pure data + a tiny persistence helper. No Three.js / React imports here so it
 * stays trivially importable and testable.
 */

export interface VisualSettings {
  /** Per-column horizontal shear strength (the fake "curve"). 0 = flat squares. */
  shear: number;
  /** Orthographic camera zoom (frames the 16x10 well). */
  zoom: number;
  /** Energy-ball variant emissive (only used by the 'energy' variant; kept for parity). */
  emissiveIntensity: number;
  /** Slow breathe on emissive materials. OFF by default (deferred to Phase 2 beat-reactive). */
  beatPulse: boolean;
  /** Bright-cell illuminating side-face emissive. */
  brightFaceIntensity: number;
  /** Bright-cell inner orb emissive. */
  innerLightIntensity: number;
  /** Bright-cell glassy body opacity. */
  glassOpacity: number;
  /** Dark-cell side-face emissive. */
  darkFaceIntensity: number;
  /** Dark-cell inner X emissive. */
  darkCoreIntensity: number;
  /** Back-plane cell grid opacity. */
  gridOpacity: number;
  /** Bloom strength. */
  bloomIntensity: number;
  /** Bloom luminance threshold (only > this blooms). */
  luminanceThreshold: number;

  // --- Phase 2: Arise VFX layer (all render-only, all tunable + persisted) ---
  /**
   * Beat-reactive master toggle: pulse bloom + block emissive GENTLY on the
   * beat (phase derived from sweepX/bpm). Default ON.
   */
  beatReactive: boolean;
  /**
   * Beat breathe amplitude (fraction). The on-beat swell is ±beatStrength on
   * bloom + emissive. KEPT LOW by default and the curve is a smooth cosine, so
   * it is a gentle breathe, NEVER a strobe (a11y: flagged seizure risk). Slider
   * is capped well below anything that could flash.
   */
  beatStrength: number;
  /** Particle bursts on square/chain clears. Default ON. */
  burstEnabled: boolean;
  /** Particles spawned per cleared cell (scaled then capped). */
  burstPerCell: number;
  /** Hard cap on particles in a single burst (perf guard). */
  burstCap: number;
  /** Reactive evolving background shader plane behind the well. Default ON. */
  bgEnabled: boolean;
  /** Background shader brightness / presence (0 = invisible, subtle by default). */
  bgIntensity: number;
  /** Slow-drop heat glow on the descending piece. Default ON. */
  heatEnabled: boolean;
  /** Peak extra emissive added to the descending piece at full soft-drop speed. */
  heatIntensity: number;
  /** Gem / special-cell indicator. Default ON. */
  gemEnabled: boolean;
  /** Gem emissive boost / marker brightness. */
  gemIntensity: number;
  /** In-canvas 3D next-piece preview dock. Default ON. */
  previewEnabled: boolean;
}

/**
 * Rai's tuned defaults (2026-06-07). Baked here so the game opens looking right
 * even before the panel is touched / localStorage is empty.
 */
export const DEFAULT_SETTINGS: VisualSettings = {
  shear: 0.4,
  zoom: 30,
  emissiveIntensity: 0.55,
  beatPulse: false,
  brightFaceIntensity: 0.25,
  innerLightIntensity: 0.6,
  glassOpacity: 0.37,
  darkFaceIntensity: 1.25,
  darkCoreIntensity: 0.9,
  gridOpacity: 0.73,
  bloomIntensity: 1.2,
  luminanceThreshold: 0.74,

  // Phase 2 — Arise VFX defaults. Tuned conservative: alive but not distracting,
  // and the beat breathe is a small, slow swell (a11y-safe).
  beatReactive: true,
  beatStrength: 0.12, // ±12% gentle swell, smooth cosine — not a strobe
  burstEnabled: true,
  burstPerCell: 6,
  burstCap: 60,
  bgEnabled: true,
  bgIntensity: 0.35,
  heatEnabled: true,
  heatIntensity: 1.6,
  gemEnabled: true,
  gemIntensity: 1.4,
  previewEnabled: true,
};

/** localStorage key for persisted visual settings. */
export const SETTINGS_STORAGE_KEY = "llmines.visualSettings.v1";

/**
 * Load persisted settings merged over the baked defaults. Any missing / corrupt
 * key falls back to its default, so a partial or stale stored blob never breaks
 * the look. SSR / no-window safe (returns defaults).
 */
export function loadSettings(): VisualSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VisualSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist the full settings blob. SSR / no-window safe (no-op). */
export function saveSettings(settings: VisualSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota / privacy-mode failures are non-fatal: the look just won't persist.
  }
}
