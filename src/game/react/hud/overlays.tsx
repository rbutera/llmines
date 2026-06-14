/**
 * Cockpit-HUD overlays: Pause, Controls, Game-over. Full-screen scrim + a
 * bevel modal. Entrances are transform-only (never opacity->0) so a throttled /
 * background tab can never leave the panel stuck invisible.
 */

import { useEffect, useRef } from "react";
import { Cheatsheet, Corners, fmt, Keys, Piece } from "./atoms";
import { SettingsBlock } from "./SettingsBlock";

/**
 * Pause overlay. Raised by the pause button, Esc, window blur, or the page
 * losing visibility. Carries the settings block + the control scheme + RESUME /
 * END RUN. Clicking the scrim (not the modal) resumes.
 */
export function PauseOverlay({
  onResume,
  onEnd,
  musicVolume,
  onVolumeChange,
  muted,
  onToggleMute,
}: {
  onResume: () => void;
  onEnd: () => void;
  musicVolume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("overlay")) onResume();
      }}
    >
      <div className="bevel modal">
        <Corners size={14} inset={7} />
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            className="glow-text cap"
            style={{ fontSize: 40, fontWeight: 800 }}
          >
            PAUSED
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            signal held · click outside or esc to resume
          </div>
        </div>

        <SettingsBlock
          musicVolume={musicVolume}
          onVolumeChange={onVolumeChange}
          muted={muted}
          onToggleMute={onToggleMute}
        />

        <div
          style={{
            height: 1,
            background: "oklch(0.5 0.1 var(--hue) / .25)",
            margin: "20px 0 16px",
          }}
        />
        <div className="label" style={{ marginBottom: 12 }}>
          CONTROL SCHEME
        </div>
        <Cheatsheet />

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: "14px 0", fontSize: 15 }}
            onClick={onResume}
          >
            ▶ RESUME
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "14px 22px", fontSize: 13 }}
            onClick={onEnd}
          >
            END RUN
          </button>
        </div>
      </div>
    </div>
  );
}

/** Controls overlay (on-demand from Start). Closeable by scrim, button, or Esc. */
export function ControlsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("overlay")) onClose();
      }}
    >
      <div className="bevel modal" style={{ width: "min(420px, 86%)" }}>
        <Corners size={14} inset={7} />
        <div
          className="glow-text cap"
          style={{
            fontSize: 26,
            fontWeight: 800,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          CONTROLS
        </div>
        <Cheatsheet />
        <button
          type="button"
          className="btn btn-primary"
          style={{
            width: "100%",
            padding: "13px 0",
            fontSize: 14,
            marginTop: 24,
          }}
          onClick={onClose}
        >
          ▸ CLOSE
        </button>
      </div>
    </div>
  );
}

/** A small numbered step heading inside the tutorial. */
function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        aria-hidden
        className="glow-text cap-tight"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          flex: "0 0 auto",
          fontSize: 12,
          fontWeight: 800,
          border: "1px solid var(--line)",
          borderRadius: 4,
          boxShadow: "0 0 8px var(--accent)",
        }}
      >
        {n}
      </span>
      <span className="cap-tight glow-text" style={{ fontSize: 14 }}>
        {title}
      </span>
    </div>
  );
}

/**
 * HOW TO PLAY tutorial (on-demand from Start). A skimmable, visual rundown of the
 * objective, the timeline-sweep clear rule, chain gems, the bonuses, and the
 * scoring — closeable by scrim, the CLOSE button, or Esc. Lives ONLY on the
 * Start screen (it never adds chrome to the playing HUD). Keyboard: the panel is
 * a labelled modal dialog, focus lands on CLOSE, and the Start-phase key handler
 * routes Esc to `onClose`.
 */
export function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Move focus into the dialog on open so keyboard + screen-reader users land
  // inside it (and Esc/Tab behave predictably). Restored to the opener by the
  // Start screen when the overlay unmounts.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="overlay"
      data-testid="tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("overlay")) onClose();
      }}
    >
      <div className="bevel modal" style={{ width: "min(560px, 92%)" }}>
        <Corners size={14} inset={7} />
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div
            id="tutorial-title"
            className="glow-text cap"
            style={{ fontSize: 26, fontWeight: 800 }}
          >
            HOW TO PLAY
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            clear blocks in time with the music
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          {/* OBJECTIVE */}
          <section style={{ display: "grid", gap: 7 }}>
            <StepHead n={1} title="Stack two colours" />
            <p className="hint" style={{ margin: 0, lineHeight: 1.5 }}>
              Pieces fall as 2×2 blocks of two colours. Move, rotate and drop them
              to line up same-colour cells.
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
              <Piece cells={["lite", "dark", "dark", "lite"]} />
              <Piece cells={["dark", "dark", "lite", "lite"]} />
            </div>
          </section>

          {/* SQUARES + SWEEP */}
          <section style={{ display: "grid", gap: 7 }}>
            <StepHead n={2} title="Form squares, ride the sweep" />
            <p className="hint" style={{ margin: 0, lineHeight: 1.5 }}>
              Any 2×2 (or bigger) area of a single colour becomes a square. A
              timeline bar sweeps across the field on the beat and clears every
              completed square it passes. Bigger single-sweep clears score far
              more.
            </p>
          </section>

          {/* GEMS / FLOOD */}
          <section style={{ display: "grid", gap: 7 }}>
            <StepHead n={3} title="Chain gems flood-clear" />
            <p className="hint" style={{ margin: 0, lineHeight: 1.5 }}>
              Some pieces carry a glowing{" "}
              <span style={{ color: "var(--gold)", fontWeight: 700 }}>
                chain gem
              </span>
              . When the sweep hits it, it floods through every connected
              same-colour block — a chain reaction worth a big multiplier.
            </p>
            <div style={{ marginTop: 2 }}>
              <Piece cells={["lite", "dark", "lite", "dark"]} chain={0} />
            </div>
          </section>

          {/* BONUSES + SCORING */}
          <section style={{ display: "grid", gap: 7 }}>
            <StepHead n={4} title="Bonuses & scoring" />
            <ul
              className="hint"
              style={{
                margin: 0,
                paddingLeft: 18,
                lineHeight: 1.6,
                listStyle: "square",
              }}
            >
              <li>
                Single-sweep clears scale fast — clear more squares at once for a
                streak multiplier.
              </li>
              <li>
                <strong>All-clear:</strong> wipe the whole field for a big bonus.
              </li>
              <li>
                <strong>Single colour:</strong> reduce the board to one colour for
                a bonus.
              </li>
            </ul>
          </section>

          {/* CONTROLS */}
          <section style={{ display: "grid", gap: 9 }}>
            <StepHead n={5} title="Controls" />
            <Cheatsheet />
            <div
              className="hint"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span>also</span>
              <Keys list={["h", "j", "k", "l"]} />
              <span>or</span>
              <Keys list={["e", "s", "d", "f"]} />
            </div>
          </section>
        </div>

        <button
          ref={closeRef}
          type="button"
          data-testid="tutorial-close"
          className="btn btn-primary"
          style={{
            width: "100%",
            padding: "13px 0",
            fontSize: 14,
            marginTop: 24,
          }}
          onClick={onClose}
        >
          ▸ GOT IT
        </button>
      </div>
    </div>
  );
}

/**
 * Game-over overlay. Carries the `game-over` + `restart` test contract testids
 * and the authoritative `score` text. Saving the score is handled upstream
 * (GameShell submits via useScores on the gameover transition).
 */
export function GameOverView({
  score,
  best,
  signedIn,
  onAgain,
  onLeaderboard,
}: {
  score: number;
  best: number | null;
  signedIn: boolean;
  onAgain: () => void;
  onLeaderboard: () => void;
}) {
  const isBest = signedIn && best != null && score >= best;
  return (
    <div
      className="overlay"
      data-testid="game-over"
      aria-label="Game over"
      style={{
        background:
          "radial-gradient(70% 70% at 50% 45%, rgba(0,0,0,.5), rgba(0,0,0,.9))",
      }}
    >
      <div
        className="modal"
        style={{ textAlign: "center", width: "min(560px,88%)" }}
      >
        <div className="cap label pulse" style={{ marginBottom: 10 }}>
          ◈ SIGNAL LOST ◈
        </div>
        <div
          className="glow-text cap"
          style={{ fontSize: 56, fontWeight: 800, letterSpacing: ".1em" }}
        >
          GAME OVER
        </div>
        <div className="label" style={{ marginTop: 26 }}>
          FINAL SCORE
        </div>
        {/* Final score readout. Deliberately does NOT carry the `score` testid:
            that id belongs to the single in-play HUD score, and the e2e restart
            assertion reads it after returning to the playing phase. */}
        <div
          className="readout glow-text"
          style={{ fontSize: 72, lineHeight: 1 }}
        >
          {fmt(score)}
        </div>
        {isBest && (
          <div
            className="cap-tight glow-text blink"
            style={{ fontSize: 13, marginTop: 8 }}
          >
            ★ NEW PERSONAL BEST ★
          </div>
        )}
        {!isBest && signedIn && best != null && (
          <div className="hint" style={{ marginTop: 8 }}>
            best · {fmt(best)}
          </div>
        )}
        {!signedIn && (
          <div className="hint" style={{ marginTop: 8 }}>
            sign in to save your score
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            marginTop: 34,
          }}
        >
          <button
            type="button"
            data-testid="restart"
            className="btn btn-primary"
            style={{ padding: "15px 44px", fontSize: 17 }}
            onClick={onAgain}
            autoFocus
          >
            ▶ PLAY AGAIN
          </button>
          <button
            type="button"
            data-testid="gameover-leaderboard"
            className="btn"
            style={{ padding: "15px 28px", fontSize: 13 }}
            onClick={onLeaderboard}
          >
            ◫ RANKS
          </button>
        </div>
      </div>
    </div>
  );
}
