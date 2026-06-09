"use client";

/**
 * Account/identity screens in the cockpit-HUD style:
 *
 * - UsernameSelect: shown after first Google sign-in. Prefilled with the
 *   collision-numbered suggestion (derived from the Google display name),
 *   editable, validity + uniqueness checked live. The chosen username is what
 *   shows on the leaderboard. Reads/writes via `useAuth`.
 * - LeaderboardOverlay: a full top-10 leaderboard view (its own overlay,
 *   reachable from Start and Game Over). Reads via `useScores`.
 *
 * Both are pure cockpit chrome wired to the existing account seam, so they work
 * identically against the mock (dev/eval) and the real Convex backend.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth, useScores } from "../../account/context";
import { Corners, fmt } from "./atoms";

/**
 * The username-select screen. Mounted by GameShell when `auth.needsUsername` is
 * true. Calls `onDone` once a valid, unique username is committed.
 */
export function UsernameSelect({ onDone }: { onDone: () => void }) {
  const { user, suggestedUsername, checkUsername, chooseUsername, signOut } =
    useAuth();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Prefill with the suggestion once it resolves (only before the user types).
  useEffect(() => {
    if (!touched && suggestedUsername) setValue(suggestedUsername);
  }, [suggestedUsername, touched]);

  // Live format + uniqueness feedback (the server is authoritative on submit).
  const check = useMemo(() => checkUsername(value), [checkUsername, value]);
  const showError = touched && !check.available;
  const reason = serverError ?? (showError ? check.reason : null);
  const canSubmit = check.available && !submitting;

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (!check.available) return;
    setSubmitting(true);
    try {
      await chooseUsername(value);
      onDone();
    } catch (e) {
      setServerError(
        e instanceof Error ? e.message : "Could not save username.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className="overlay"
      data-testid="username-select"
      aria-label="Choose your username"
    >
      <div className="bevel modal" style={{ width: "min(440px, 88%)" }}>
        <Corners size={14} inset={7} />
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="cap label" style={{ marginBottom: 6 }}>
            ◈ IDENTIFY PILOT ◈
          </div>
          <div
            className="glow-text cap"
            style={{ fontSize: 30, fontWeight: 800 }}
          >
            CHOOSE YOUR NAME
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            this is the name on the leaderboard · you can change it later
          </div>
        </div>

        <label className="label" htmlFor="username-input">
          CALLSIGN
        </label>
        <input
          id="username-input"
          data-testid="username-input"
          className={`field ${showError ? "bad" : ""}`}
          style={{
            width: "100%",
            marginTop: 8,
            padding: "13px 14px",
            fontSize: 17,
            fontWeight: 700,
          }}
          value={value}
          maxLength={24}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setTouched(true);
            setServerError(null);
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />

        <div style={{ minHeight: 20, marginTop: 8 }}>
          {reason ? (
            <span
              data-testid="username-error"
              className="cap-tight"
              style={{ fontSize: 11, color: "oklch(0.7 0.2 25)" }}
            >
              {reason}
            </span>
          ) : (
            value.trim().length > 0 &&
            check.available && (
              <span
                data-testid="username-ok"
                className="cap-tight glow-text"
                style={{ fontSize: 11 }}
              >
                ✓ AVAILABLE
              </span>
            )
          )}
        </div>

        <button
          type="button"
          data-testid="username-confirm"
          className="btn btn-primary"
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 15,
            marginTop: 16,
          }}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting ? "SAVING…" : "▶ CONFIRM"}
        </button>

        <div
          className="hint"
          style={{ textAlign: "center", marginTop: 14, opacity: 0.75 }}
        >
          {user?.email ? `signed in as ${user.email}` : "signed in"} ·{" "}
          <button
            type="button"
            onClick={signOut}
            className="cap-tight"
            style={{
              background: "none",
              border: "none",
              color: "var(--hud-accent-hi)",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
              letterSpacing: "0.18em",
            }}
          >
            SIGN OUT
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Full leaderboard overlay (top 10 by score). Reachable from Start and Game
 * Over. Closeable by scrim, the close button, or Esc.
 */
export function LeaderboardOverlay({
  onClose,
  highlightSubject,
}: {
  onClose: () => void;
  /** Optionally highlight the current player's row. */
  highlightSubject?: string | null;
}) {
  const { leaderboard } = useScores();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      data-testid="leaderboard"
      aria-label="Leaderboard"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("overlay")) onClose();
      }}
    >
      <div className="bevel modal" style={{ width: "min(460px, 90%)" }}>
        <Corners size={14} inset={7} />
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="cap label" style={{ marginBottom: 6 }}>
            ◈ GLOBAL RANKING ◈
          </div>
          <div
            className="glow-text cap"
            style={{ fontSize: 30, fontWeight: 800 }}
          >
            LEADERBOARD
          </div>
        </div>

        {leaderboard.length === 0 ? (
          <div
            className="hint"
            style={{ textAlign: "center", padding: "26px 0" }}
          >
            no scores logged yet · be the first
          </div>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {leaderboard.map((entry, i) => {
              const mine =
                highlightSubject != null && entry.subject === highlightSubject;
              return (
                <li
                  key={entry.subject}
                  data-testid="leaderboard-row"
                  data-rank={i + 1}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    borderBottom: "1px solid oklch(0.5 0.1 var(--hue) / 0.18)",
                    background: mine
                      ? "oklch(0.5 0.16 var(--hue) / 0.14)"
                      : "transparent",
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <span
                      className="readout"
                      style={{
                        width: 26,
                        textAlign: "right",
                        fontSize: 15,
                        color: i === 0 ? "var(--gold)" : "var(--ink-faint)",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={mine ? "glow-text" : ""}
                      style={{ fontSize: 15, fontWeight: 700 }}
                    >
                      {entry.name}
                    </span>
                  </span>
                  <span
                    className="readout"
                    style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}
                  >
                    {fmt(entry.best)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <button
          type="button"
          data-testid="leaderboard-close"
          className="btn btn-primary"
          style={{
            width: "100%",
            padding: "13px 0",
            fontSize: 14,
            marginTop: 22,
          }}
          onClick={onClose}
        >
          ▸ CLOSE
        </button>
      </div>
    </div>
  );
}
