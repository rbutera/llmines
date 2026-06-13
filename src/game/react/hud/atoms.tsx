/**
 * Cockpit-HUD atoms — the small shared building blocks (ported from the design
 * handoff `hud-kit.jsx`): Piece, Keys, Gauge, Corners, Reticle, Cheatsheet.
 *
 * Pure presentational. All visuals come from `hud.css` classes; these only
 * compose markup. No game state, no side effects.
 */

import type { CSSProperties, ReactNode } from "react";

/** One preview cell shade. */
export type PieceCellShade = "lite" | "dark";

/**
 * A 2x2 piece glyph: four block-shaded mini-cells. `chain` (0..3) outlines the
 * cell carrying a chain special in gold.
 */
export function Piece({
  cells,
  chain = -1,
}: {
  cells: readonly [
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
  ];
  chain?: number;
}) {
  return (
    <div className="piece">
      {cells.map((k, i) => (
        <div key={i} className={`pcell ${k}${i === chain ? "chain" : ""}`} />
      ))}
    </div>
  );
}

/** A single keycap glyph. */
export function Key({ children }: { children: ReactNode }) {
  return <span className="keycap">{children}</span>;
}

/** A row of keycaps. */
export function Keys({ list }: { list: readonly string[] }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {list.map((k) => (
        <Key key={k}>{k}</Key>
      ))}
    </span>
  );
}

/**
 * The BPM / tempo bar gauge: `n` vector bars, the first `active` lit. Heights
 * follow a fixed sine so the bars read like an instrument readout.
 */
export function Gauge({ n = 9, active = 6 }: { n?: number; active?: number }) {
  return (
    <div className="gauge">
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${20 + 50 * Math.abs(Math.sin((i + 1) * 1.1)) * (i < active ? 1 : 0.25)}%`,
            opacity: i < active ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

/** Targeting-bracket corners for any positioned box. */
export function Corners({
  size = 16,
  inset = -1,
}: {
  size?: number;
  inset?: number;
}) {
  const base: CSSProperties = { width: size, height: size };
  return (
    <>
      <span
        className="bracket tl"
        style={{ ...base, top: inset, left: inset }}
      />
      <span
        className="bracket tr"
        style={{ ...base, top: inset, right: inset }}
      />
      <span
        className="bracket bl"
        style={{ ...base, bottom: inset, left: inset }}
      />
      <span
        className="bracket br"
        style={{ ...base, bottom: inset, right: inset }}
      />
    </>
  );
}

/** Faint targeting reticle behind the title (start screen). */
export function Reticle({ big = false }: { big?: boolean }) {
  const s = big ? 200 : 150;
  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        width: s,
        height: s,
        opacity: big ? 0.4 : 0.3,
        pointerEvents: "none",
      }}
      viewBox="0 0 180 180"
    >
      <g
        stroke="var(--line)"
        strokeWidth="1.2"
        fill="none"
        style={{ filter: "drop-shadow(0 0 4px var(--accent))" }}
      >
        <circle cx="90" cy="90" r="60" strokeDasharray="2 8" />
        <path d="M90 14 v22 M90 144 v22 M14 90 h22 M144 90 h22" />
        <path d="M70 90 h40 M90 70 v40" strokeOpacity="0.5" />
      </g>
    </svg>
  );
}

/** Control-scheme legend (keycap rows). Mirrors the repo's keymap. */
export function Cheatsheet() {
  const rows: { keys: readonly string[]; label: string }[] = [
    { keys: ["←", "→"], label: "translate" },
    { keys: ["↑"], label: "rotate" },
    { keys: ["↓"], label: "soft drop (hold)" },
    { keys: ["space"], label: "hard drop" },
    { keys: ["esc"], label: "pause" },
  ];
  return (
    <div style={{ display: "grid", gap: 9 }}>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 22,
          }}
        >
          <Keys list={r.keys} />
          <span
            className="cap-tight"
            style={{ fontSize: 11, color: "var(--ink-faint)" }}
          >
            {r.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Format a number with thousands separators (matches the design fmt). */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
