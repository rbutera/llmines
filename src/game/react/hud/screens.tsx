/**
 * Cockpit-HUD screens: the Start/title view and the in-play HUD layer. Both are
 * pure presentational shells wired to the existing GameShell state + handlers.
 *
 * - StartView: the most-polished screen — reticle, glowing LLMINES wordmark,
 *   ENGAGE + CONTROLS, the personal-best / global-#1 stat row, and a sign-in +
 *   leaderboard footer. Reads real auth/scores via props from GameShell. There
 *   is NO skin toggle — skins advance only on song completion.
 * - PlayHud: data-on-glass over the fullscreen board. Score top-left (legible,
 *   on a backing chip), LLMINES top-rail, tempo gauge + pause top-right, NEXT
 *   queue right-edge (real queue), a timeline sweep caret driven by the REAL
 *   sweepX, inset frame + brackets, and the maximal clear juice (score pop / ×N
 *   flash / clear-wash / shake) keyed off real clear events.
 */

import type { GeneratedPiece } from "../../core";
import { COLS, PREVIEW_DEPTH } from "../../core";
import { Corners, fmt, Gauge, type PieceCellShade, Reticle } from "./atoms";

export function StartView({
  onStart,
  onControls,
  onSign,
  onLeaderboard,
  signedIn,
  signedInName,
  personalBest,
  globalTop,
}: {
  onStart: () => void;
  onControls: () => void;
  onSign: () => void;
  onLeaderboard: () => void;
  signedIn: boolean;
  signedInName: string | null;
  personalBest: number | null;
  globalTop: { name: string; best: number } | null;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <Reticle big />
      <div className="cap label blink" style={{ marginBottom: 18 }}>
        ▶ READY
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <span
          style={{
            width: 90,
            height: 1,
            background: "var(--line)",
            boxShadow: "0 0 6px var(--accent)",
          }}
        />
        <h1
          className="glow-text cap"
          style={{
            fontSize: 90,
            fontWeight: 800,
            letterSpacing: "0.16em",
            margin: 0,
          }}
        >
          LLMINES
        </h1>
        <span
          style={{
            width: 90,
            height: 1,
            background: "var(--line)",
            boxShadow: "0 0 6px var(--accent)",
          }}
        />
      </div>
      <div
        className="cap-tight"
        style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 12 }}
      >
        TIMELINE PUZZLE · SYNC TO THE BEAT
      </div>

      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 36,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          data-testid="start-button"
          className="btn btn-primary"
          style={{ padding: "16px 56px", fontSize: 18 }}
          onClick={onStart}
          autoFocus
        >
          ▶ ENGAGE
        </button>
        <button
          type="button"
          className="btn"
          style={{ padding: "16px 26px", fontSize: 13 }}
          onClick={onControls}
        >
          CONTROLS
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 40,
          marginTop: 34,
          alignItems: "center",
        }}
      >
        <div>
          <div className="label" style={{ fontSize: 9 }}>
            PERSONAL BEST
          </div>
          <div
            data-testid="personal-best"
            className="readout"
            style={{ fontSize: 22 }}
          >
            {signedIn && personalBest != null ? fmt(personalBest) : "— — —"}
          </div>
        </div>
        <div
          style={{
            width: 1,
            height: 34,
            background: "oklch(0.5 0.1 var(--hue) / .3)",
          }}
        />
        <button
          type="button"
          data-testid="open-leaderboard"
          onClick={onLeaderboard}
          title="View leaderboard"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            font: "inherit",
            color: "inherit",
          }}
        >
          <div className="label" style={{ fontSize: 9 }}>
            GLOBAL #1 ▸
          </div>
          <div className="readout" style={{ fontSize: 22 }}>
            {globalTop ? `${globalTop.name} · ${fmt(globalTop.best)}` : "— — —"}
          </div>
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 18,
          marginTop: 30,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          data-testid={signedIn ? "signout" : "signin"}
          className="btn"
          style={{ padding: "9px 16px", fontSize: 11 }}
          onClick={onSign}
        >
          {signedIn
            ? `◢ SIGNED IN · ${(signedInName ?? "PLAYER").toUpperCase()}`
            : "◢ SIGN IN TO SAVE"}
        </button>
        <button
          type="button"
          data-testid="leaderboard-button"
          className="btn"
          style={{ padding: "9px 16px", fontSize: 11 }}
          onClick={onLeaderboard}
        >
          ◫ LEADERBOARD
        </button>
      </div>

      {/* NCS attribution (kept visible per the audio licence). */}
      <div
        className="hint"
        style={{ position: "absolute", bottom: 16, opacity: 0.6 }}
      >
        Music provided by NoCopyrightSounds
      </div>
    </div>
  );
}

/** Map a GeneratedPiece's 4 cells (colour 0/1) to lite/dark shades + chain idx. */
function pieceToGlyph(gp: GeneratedPiece): {
  cells: readonly [
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
  ];
  chain: number;
} {
  const flat = [gp.cells[0][0], gp.cells[0][1], gp.cells[1][0], gp.cells[1][1]];
  const cells = flat.map((c) => (c === 0 ? "dark" : "lite")) as [
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
    PieceCellShade,
  ];
  return { cells, chain: gp.special?.cellIndex ?? -1 };
}

export function PlayHud({
  score,
  bpm,
  queue,
  sweepX,
  scoreKey,
  multKey,
  mult,
  clearKey,
  bar,
  beat,
  onPause,
}: {
  score: number;
  bpm: number;
  queue: GeneratedPiece[];
  /** Real sweep column position (0..COLS) — drives the timeline caret. */
  sweepX: number;
  /** Bumped on each score increment to replay the score pop. */
  scoreKey: number;
  /** Bumped on each chain clear to fire the ×N flash + clear-wash. */
  multKey: number;
  /** The multiplier shown in the ×N flash. */
  mult: number;
  /** Bumped on each clear to fire the clear-wash radial. */
  clearKey: number;
  /** Derived musical bar/beat for the timeline labels. */
  bar: number;
  beat: number;
  onPause: () => void;
}) {
  const upcoming = queue.slice(0, PREVIEW_DEPTH);
  // Caret rides 6%..94% of the rail, mapped from the real sweep position.
  const sweepPct = 6 + (Math.max(0, Math.min(COLS, sweepX)) / COLS) * 88;
  // BPM gauge: light a share of the 9 bars proportional to BPM (90..170 band).
  const active = Math.max(2, Math.min(9, Math.round(((bpm - 90) / 80) * 9)));

  return (
    <div className="hud-layer">
      {/* faint inset frame + bracket corners */}
      <div
        className="recede"
        style={{
          position: "absolute",
          inset: 22,
          border: "1px solid oklch(0.6 0.12 var(--hue) / 0.18)",
          pointerEvents: "none",
        }}
      />
      <Corners size={20} inset={22} />

      {/* top edge tick-rail (the bottom rail is removed — it was dead chrome) */}
      <div className="recede">
        <div
          className="tickrail"
          style={{ position: "absolute", top: 23, left: 23, right: 23 }}
        />
      </div>

      {/* score — top-left, on a legible backing chip (NOT in `.recede`, so it
          reads at full contrast against the fullscreen board). */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 40,
          padding: "8px 16px 10px",
          borderRadius: 8,
          background: "oklch(0.16 0.03 var(--hue) / 0.62)",
          border: "1px solid oklch(0.6 0.12 var(--hue) / 0.4)",
          backdropFilter: "blur(3px)",
          boxShadow: "0 2px 14px rgba(0,0,0,0.5)",
        }}
      >
        <div className="label" style={{ marginBottom: 2, opacity: 0.9 }}>
          SCORE
        </div>
        <div
          key={scoreKey}
          data-testid="score"
          className="glow-text scorepop"
          style={{
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 0.9,
            fontVariantNumeric: "tabular-nums",
            color: "var(--hud-accent-hi, #fff)",
          }}
        >
          {score}
        </div>
      </div>

      {/* LLMINES wordmark — top rail chip */}
      <div
        className="recede"
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#000",
          padding: "0 10px",
        }}
      >
        <span className="cap label">LLMINES</span>
      </div>

      {/* tempo + pause — top-right (kept clear of the renderer Settings button) */}
      <div
        style={{
          position: "absolute",
          top: 56,
          right: 44,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          className="recede"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <span data-testid="bpm" className="readout" style={{ fontSize: 13 }}>
            {Math.round(bpm)}
          </span>
          <span className="label" style={{ fontSize: 9 }}>
            BPM
          </span>
          <Gauge n={9} active={active} />
        </span>
        <button
          type="button"
          className="iconbtn"
          style={{ width: 38, height: 34, fontSize: 14 }}
          onClick={onPause}
          title="Pause (Esc)"
          aria-label="Pause"
        >
          ❚❚
        </button>
      </div>

      {/* NEXT queue — right edge, real upcoming pieces */}
      <div
        data-testid="preview"
        className="recede"
        style={{
          position: "absolute",
          top: "50%",
          right: 40,
          transform: "translateY(-50%)",
          display: "grid",
          gap: 12,
          justifyItems: "center",
        }}
      >
        <div className="label" style={{ fontSize: 9 }}>
          NEXT
        </div>
        {upcoming.map((gp, i) => {
          const glyph = pieceToGlyph(gp);
          return (
            <div
              key={i}
              style={{ display: "grid", gap: 3, justifyItems: "center" }}
            >
              <div className="piece">
                {glyph.cells.map((k, ci) => (
                  <div
                    key={ci}
                    className={`pcell ${k}${ci === glyph.chain ? "chain" : ""}`}
                  />
                ))}
              </div>
              {gp.special && (
                <span
                  data-testid="preview-special"
                  className="cap-tight"
                  style={{ fontSize: 8, color: "var(--gold)" }}
                >
                  chain
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* timeline sweep — bottom, caret driven by REAL sweepX */}
      <div
        className="recede"
        style={{ position: "absolute", bottom: 40, left: 44, right: 44 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span className="label" style={{ fontSize: 9 }}>
            TIMELINE SWEEP
          </span>
          <span className="label" style={{ fontSize: 9 }}>
            BAR {bar} · BEAT {beat}
          </span>
        </div>
        <div className="tickrail tall" style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              left: `${sweepPct}%`,
              top: -6,
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "10px solid var(--hud-accent-hi)",
              filter: "drop-shadow(0 0 6px var(--accent))",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${sweepPct}%`,
              top: 0,
              bottom: 0,
              transform: "translateX(-50%)",
              width: 2,
              background: "var(--hud-accent-hi)",
              boxShadow: "0 0 10px var(--accent)",
            }}
          />
        </div>
      </div>

      {/* transient chain juice — keyed off real clear events */}
      {multKey > 0 && (
        <div className="mult-flash" key={multKey}>
          <div
            style={{
              fontSize: 110,
              fontWeight: 800,
              lineHeight: 0.8,
              color: "transparent",
              WebkitTextStroke: "1.6px var(--accent)",
              filter: "drop-shadow(0 0 14px var(--accent))",
            }}
          >
            ×{mult}
          </div>
          <div className="cap-tight glow-text" style={{ fontSize: 13 }}>
            CHAIN CLEAR
          </div>
        </div>
      )}
      {clearKey > 0 && <div className="clear-flash" key={"cf" + clearKey} />}
    </div>
  );
}
