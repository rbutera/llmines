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
  /**
   * Gem marker colour for the LIGHT variant — used on BRIGHT / white blocks.
   * GOLD, so a gem sitting on a light block reads instantly as "gold gem on
   * white". Owner-specified (2026-06-07).
   */
  gemLightColor: string;
  /**
   * Gem marker colour for the DARK variant — used on DARK blocks. BRIGHT PURPLE,
   * so a gem sitting on a dark block reads instantly as "purple gem on dark" —
   * the opposite of the gold light-block variant. Owner-specified (2026-06-07).
   */
  gemDarkColor: string;
  /** In-canvas 3D next-piece preview dock. Default ON. */
  previewEnabled: boolean;

  // --- FIX 2: visual hierarchy (calm settled vs pulsing to-clear) ----------
  /**
   * Emissive multiplier applied to SETTLED (placed, not-about-to-clear) cells.
   * < 1 dials them DOWN so they read as inert/placed and don't compete with the
   * active piece or the to-clear pulse. 1.0 = no change.
   */
  settledEmissive: number;
  /**
   * Peak emissive added to MARKED (about-to-clear) cells as a bright pulse, so a
   * cell the sweep is about to clear is unmistakably distinct from a calm settled
   * cell. Additive on top of the (dialled-down) settled emissive; pulses on a
   * steady fast cosine (its own, not the gentle beat breathe).
   */
  markedPulse: number;

  // --- Phase 3: chain-clear travelling wavefront (render-only, tunable) ---
  /** Travelling chain-clear wavefront flash. Default ON. */
  chainEnabled: boolean;
  /**
   * Wavefront travel speed: ms per BFS-distance ring. Lower = faster snap;
   * higher = a slower, more dramatic spread. Tuned ~55ms/ring by default
   * (snappy for small clears, a visible cascade for big ones).
   */
  chainSpeed: number;
  /** Peak brightness of each cell's chain-flash. */
  chainIntensity: number;
  /**
   * Climax SHOCKWAVE ring: a brief expanding ring across the well when the
   * furthest cell of a chain clears. Scales with the cleared component size.
   * Default ON.
   */
  shockwaveEnabled: boolean;
  /**
   * Board-state BONUS celebration animations (render-only). When a pass reduces
   * the field to a single colour (single-colour bonus) or empties it (all-clear
   * bonus), an OBVIOUS wavefront-style flash washes the affected cells — a warm
   * colour-wash for single-colour, a full-board white bloom + shockwave for the
   * all-clear (the biggest payoff). Reuses the chain wavefront engine. Default ON.
   */
  bonusEnabled: boolean;

  // --- PART 3: soft / fast drop feedback (render-only, tunable) -------------
  /** Soft-drop motion-smear + speed-line trail on the descending piece. Default ON. */
  dropTrailEnabled: boolean;
  /** Peak strength of the soft-drop motion-smear / speed lines (scales with speed). */
  dropTrailIntensity: number;
  /** Hard-drop slam: white-hot streak + impact spark puff + screen-shake. Default ON. */
  slamEnabled: boolean;
  /** Peak strength of the hard-drop slam streak + impact (scales with fall distance). */
  slamIntensity: number;
  /** Peak screen-shake amplitude (world units) on a hard-drop landing. */
  slamShake: number;

  // --- Current-column highlight (render-only position indicator) ------------
  /**
   * Lighten the column(s) the active piece occupies as a soft vertical wash, so
   * the player can read where the piece will land. Default ON.
   */
  columnHighlightEnabled: boolean;
  /** Peak opacity (0..1) of the current-column wash. Subtle by default. */
  columnHighlightOpacity: number;

  // --- Audio --------------------------------------------------------------
  /**
   * Music volume (0..1) for the backing track, wired to the `<audio>` element's
   * volume (the music output gain). Default 0.5. Persisted with the rest so a
   * reload restores the last-set loudness.
   */
  musicVolume: number;
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
  // OFF by default: the video backdrop (VideoBackdrop) is now the background and
  // the canvas is transparent so it shows through. The old shader field is opaque
  // and would cover the video; kept behind the setting for opt-in experimentation.
  bgEnabled: false,
  bgIntensity: 0.35,
  heatEnabled: true,
  heatIntensity: 1.6,
  gemEnabled: true,
  // Polish round (item 4): the old marker (2.6, oversized amber octahedron)
  // overpowered the board and obscured the block colour. Dial it down to a
  // subtle-but-clear inlay; the light/dark variants below adapt to the cell so
  // the underlying colour identity is preserved.
  // Round-2 (owner: "saw ZERO gems"). The gem WAS rendering all along, but the
  // marker was too small + too LOW-CONTRAST to spot: gold on white blocks and
  // purple on purple blocks both blended (and the cohesion re-theme pushed the
  // chrome/surround toward the same purple as the dark-gem colour, worsening the
  // purple-on-purple blend). Fix = UNMISTAKABLE: bigger marker (Cube), brighter
  // glow, and HIGH-CONTRAST variants that pop against EACH block type (swapped).
  gemIntensity: 3.0,
  // Light variant — used on BRIGHT / WHITE blocks: deep saturated MAGENTA so the
  // gem pops hard against the near-white block (gold-on-white was invisible).
  gemLightColor: "#ff2bd6",
  // Dark variant — used on DARK / PURPLE-X blocks: bright GOLD/amber so the gem
  // pops against the violet block (purple-on-purple was invisible).
  gemDarkColor: "#ffd23f",
  previewEnabled: true,

  // Polish-fix — visual hierarchy, contrast pushed HARD (owner: "want way more
  // contrast"). Three-tier read: settled = DIM + steady; active/falling =
  // bright + steady (no pulse — owner flagged the active-piece pulse as
  // seizure-inducing); to-clear/marked = bright + PULSING. Settled is dialled
  // far down and the marked pulse far up so the to-clear read is unmistakable.
  settledEmissive: 0.18,
  markedPulse: 5.5,

  // Chain wavefront (item 7): make the gem-clear cascade OBVIOUS. Slow the ring
  // travel a touch (90ms/ring) so the cascade is clearly seen sweeping across the
  // connected region, and brighten each flash + keep the climax shockwave on.
  chainEnabled: true,
  chainSpeed: 90,
  chainIntensity: 3.2,
  shockwaveEnabled: true,
  // Board-state bonus celebrations ON: single-colour = warm colour-wash pulse,
  // all-clear = full-board white bloom + shockwave (the biggest moment).
  bonusEnabled: true,

  // Drop feedback (item 8): reworked so soft and hard read distinctly. Soft-drop
  // is a clear sustained warm trail (it now glides continuously while held — see
  // the sustained mechanic), so the trail is brighter; hard-drop is a sharper
  // slam with a tighter, punchier shake and a brighter impact.
  dropTrailEnabled: true,
  dropTrailIntensity: 2.0,
  slamEnabled: true,
  // Polish-fix drop rework: hard-drop must read as SPEED + a real slam. The
  // streak/blur + impact flash + bigger, snappier shake scale with these. Pushed
  // up so the landing punches instead of sprinkling faint dust.
  slamIntensity: 2.6,
  slamShake: 0.5,

  // Current-column highlight: a subtle full-height wash behind the two columns
  // the active piece occupies, so where it'll land reads at a glance. Calm + low
  // opacity so it never competes with the blocks (a11y: a slow breathe, no flash).
  columnHighlightEnabled: true,
  columnHighlightOpacity: 0.16,

  // Audio — backing-track loudness. Half volume by default.
  musicVolume: 0.5,
};

/**
 * Visual-settings schema version. Bumped when a polish round REDEFINES the
 * meaning / target value of an existing key (not when adding a new key — new
 * keys fall back to their default automatically via the merge). On load, a
 * stored blob with a lower `schemaVersion` has the affected keys force-reset to
 * the current defaults so a stale localStorage value (e.g. the pre-polish gem
 * colours, or the seizure-inducing active-piece pulse settings) can't keep
 * overriding the fix. Everything else the player tuned is preserved.
 */
export const SETTINGS_SCHEMA_VERSION = 3;

/**
 * Keys whose DEFAULT meaning changed in the 2026-06-07 polish-fix round. A
 * stored blob older than {@link SETTINGS_SCHEMA_VERSION} has exactly these keys
 * reset to the current default (the values that encode the fix: gold/purple gem
 * variants, the harder settled-vs-marked contrast, the reworked drop FX), while
 * leaving the player's other tuning (zoom, shear, volume, …) intact.
 */
const POLISH_FIX_RESET_KEYS = [
  "gemLightColor",
  "gemDarkColor",
  "gemIntensity",
  "settledEmissive",
  "markedPulse",
  "slamIntensity",
  "slamShake",
  "dropTrailIntensity",
] as const satisfies readonly (keyof VisualSettings)[];

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
    const parsed = JSON.parse(raw) as Partial<VisualSettings> & {
      schemaVersion?: number;
    };
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Schema migration: a blob older than the current version has the keys whose
    // DEFAULT meaning changed this round force-reset to the new defaults, so a
    // stale stored value can never keep overriding the fix (e.g. the old gem
    // colours, or the active-piece-pulse contrast values).
    if ((parsed.schemaVersion ?? 0) < SETTINGS_SCHEMA_VERSION) {
      for (const key of POLISH_FIX_RESET_KEYS) {
        // Each reset key is assigned its current default; the union of value
        // types is widened to `never` by the generic key, so cast through the
        // shared settings shape.
        (merged as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
      }
    }
    // `zoom` drives the orthographic camera's auto-fit normalisation; a stale or
    // hand-edited `0`/negative/NaN here would zero the camera zoom and blank the
    // scene (singular projection). Sanitise it back to the default if it isn't a
    // sane positive number, so a corrupt blob can never freeze the playfield.
    if (!Number.isFinite(merged.zoom) || merged.zoom <= 0) {
      merged.zoom = DEFAULT_SETTINGS.zoom;
    }
    // Clamp music volume to a valid [0,1] gain; fall back to the default if a
    // stale/hand-edited blob carries a NaN or out-of-range value.
    if (!Number.isFinite(merged.musicVolume)) {
      merged.musicVolume = DEFAULT_SETTINGS.musicVolume;
    } else {
      merged.musicVolume = Math.max(0, Math.min(1, merged.musicVolume));
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist the full settings blob. SSR / no-window safe (no-op). */
export function saveSettings(settings: VisualSettings): void {
  if (typeof window === "undefined") return;
  try {
    // Stamp the current schema version so the one-time polish-fix migration in
    // loadSettings does not re-run on a blob we've already migrated/written.
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...settings, schemaVersion: SETTINGS_SCHEMA_VERSION }),
    );
  } catch {
    // Quota / privacy-mode failures are non-fatal: the look just won't persist.
  }
}
