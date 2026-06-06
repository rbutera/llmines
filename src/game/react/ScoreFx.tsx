"use client";

import { useEffect, useRef, useState } from "react";
import { countUpDurationMs, fxTier, type FxTier } from "./score-effects";

/**
 * Cosmetic, in-view score juice. Sits over the game board (pointer-events-none)
 * and reacts to score INCREASES with a count-up + pop/scale + flash, scaling
 * intensity with the size of the clear (US2). It NEVER renders the authoritative
 * score — that stays the exact integer in the `data-testid="score"` HUD element.
 *
 * Test hooks: `data-testid="score-fx"` (the overlay) and `data-fx-tier`
 * ("modest" | "big" while a celebration plays, else "none").
 */

interface Burst {
  id: number;
  tier: Exclude<FxTier, "none">;
}

const BURST_MS: Record<Exclude<FxTier, "none">, number> = {
  modest: 850,
  big: 1500,
};

/** How many particles a tier emits (0 when idle). */
function particleCount(t: FxTier): number {
  return t === "big" ? 16 : t === "modest" ? 6 : 0;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ScoreFx({ score }: { score: number }) {
  const prevScore = useRef(score);
  const displayRef = useRef(score);
  const nextId = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [displayValue, setDisplayValue] = useState(score);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  const [popKey, setPopKey] = useState(0);
  const [lastTier, setLastTier] = useState<FxTier>("none");

  useEffect(() => {
    const delta = score - prevScore.current;
    prevScore.current = score;

    // Non-positive delta (including restart -> 0): no celebration, reset cleanly.
    if (delta <= 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      displayRef.current = score;
      setDisplayValue(score);
      setBursts([]);
      setGain(null);
      setLastTier("none");
      return;
    }

    const tier = fxTier(delta) as Exclude<FxTier, "none">;
    setLastTier(tier);
    setPopKey((k) => k + 1);

    const id = nextId.current++;
    setBursts((b) => [...b, { id, tier }]);
    setGain({ id, amount: delta });
    const expire = setTimeout(() => {
      setBursts((b) => b.filter((x) => x.id !== id));
      setGain((g) => (g?.id === id ? null : g));
      setLastTier((t) => (bursts.length <= 1 ? "none" : t));
    }, BURST_MS[tier]);

    // Cosmetic count-up of a SEPARATE number (never the authoritative testid).
    const from = displayRef.current;
    const to = score;
    const dur = prefersReducedMotion() ? 0 : countUpDurationMs(delta);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (dur <= 0) {
      displayRef.current = to;
      setDisplayValue(to);
    } else {
      let start = 0;
      const step = (now: number) => {
        if (start === 0) start = now;
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = Math.round(from + (to - from) * eased);
        displayRef.current = v;
        setDisplayValue(v);
        if (t < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    }

    return () => clearTimeout(expire);
    // Intentionally keyed on `score` only; latest display/bursts are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const active = bursts.length > 0;
  const tier: FxTier = active ? lastTier : "none";
  const reduced = prefersReducedMotion();

  return (
    <div
      data-testid="score-fx"
      data-fx-tier={tier}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <style>{KEYFRAMES}</style>

      {/* Big-clear flash wash */}
      {active && tier === "big" && !reduced && (
        <div
          key={`flash-${popKey}`}
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 38%, rgba(255,242,168,0.55), rgba(255,242,168,0) 60%)",
            animation: "scfx-flash 520ms ease-out forwards",
          }}
        />
      )}

      {/* Count-up readout + gain, popping in the upper-middle of the board */}
      {active && (
        <div className="absolute inset-x-0 top-[18%] flex flex-col items-center">
          <div
            key={`pop-${popKey}`}
            className="font-mono font-black tabular-nums tracking-tight text-white drop-shadow-[0_2px_18px_rgba(55,224,201,0.7)]"
            style={{
              fontSize: tier === "big" ? "4.5rem" : "3rem",
              color: tier === "big" ? "#fff2a8" : "#9bf6e8",
              animation: reduced
                ? undefined
                : `scfx-pop ${tier === "big" ? 560 : 420}ms cubic-bezier(.18,.9,.32,1.4)`,
            }}
          >
            {displayValue}
          </div>
          {gain && (
            <div
              key={`gain-${gain.id}`}
              className="font-mono text-xl font-bold text-[#37e0c9]"
              style={{
                animation: reduced
                  ? undefined
                  : "scfx-rise 900ms ease-out forwards",
              }}
            >
              +{gain.amount}
            </div>
          )}
        </div>
      )}

      {/* Particle burst — more + bigger for big clears */}
      {active && !reduced &&
        Array.from({ length: particleCount(lastTier) }).map(
          (_, i, arr) => {
            const angle = (i / arr.length) * Math.PI * 2;
            const dist = lastTier === "big" ? 180 : 110;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            return (
              <span
                key={`p-${popKey}-${i}`}
                className="absolute top-[24%] left-1/2 h-2 w-2 rounded-full"
                style={
                  {
                    background: i % 2 ? "#ff5fb0" : "#37e0c9",
                    // custom props consumed by the keyframes
                    "--dx": `${dx}px`,
                    "--dy": `${dy}px`,
                    animation: `scfx-particle ${lastTier === "big" ? 1100 : 750}ms ease-out forwards`,
                  } as React.CSSProperties
                }
              />
            );
          },
        )}
    </div>
  );
}

const KEYFRAMES = `
@keyframes scfx-pop {
  0% { transform: scale(0.6); opacity: 0; }
  45% { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes scfx-rise {
  0% { transform: translateY(8px); opacity: 0; }
  25% { opacity: 1; }
  100% { transform: translateY(-28px); opacity: 0; }
}
@keyframes scfx-flash {
  0% { opacity: 0; }
  30% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes scfx-particle {
  0% { transform: translate(-50%, -50%); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-testid="score-fx"] * { animation: none !important; }
}
`;
