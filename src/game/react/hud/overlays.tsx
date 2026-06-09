/**
 * Cockpit-HUD overlays: Pause, Controls, Game-over. Full-screen scrim + a
 * bevel modal. Entrances are transform-only (never opacity->0) so a throttled /
 * background tab can never leave the panel stuck invisible.
 */

import type { AudioMix } from "../../audio/procedural/presets";
import { Cheatsheet, Corners, fmt } from "./atoms";
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
  audioMix,
  onMixChange,
  skinId,
  onSelectSkin,
}: {
  onResume: () => void;
  onEnd: () => void;
  musicVolume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  audioMix: AudioMix;
  onMixChange: (m: AudioMix) => void;
  skinId: string;
  onSelectSkin: (id: string) => void;
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
          audioMix={audioMix}
          onMixChange={onMixChange}
          skinId={skinId}
          onSelectSkin={onSelectSkin}
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
  onTitle,
  onLeaderboard,
}: {
  score: number;
  best: number | null;
  signedIn: boolean;
  onAgain: () => void;
  onTitle: () => void;
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
          <button
            type="button"
            className="btn"
            style={{ padding: "15px 28px", fontSize: 13 }}
            onClick={onTitle}
          >
            TITLE
          </button>
        </div>
      </div>
    </div>
  );
}
