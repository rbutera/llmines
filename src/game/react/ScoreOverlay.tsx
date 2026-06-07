"use client";

import { useEffect, useRef, useState } from "react";

interface FloatItem {
  id: number;
  amount: number;
}

/**
 * In-view animated score (F4). Renders over the game canvas and carries the
 * single authoritative `data-testid="score"`.
 *
 * Juice without breaking assertions:
 *  - a count-up eases the displayed value toward `score` and ALWAYS settles
 *    exactly on the integer target (and snaps immediately on reset/decrease),
 *    so the settled testid text equals the authoritative score;
 *  - each increase replays a pop/scale + glow (keyed re-mount) and pushes a
 *    floating "+N" indicator that drifts up and fades.
 */
export function ScoreOverlay({ score }: { score: number }) {
  const [displayed, setDisplayed] = useState(score);
  const [popKey, setPopKey] = useState(0);
  const [floats, setFloats] = useState<FloatItem[]>([]);

  const displayedRef = useRef(score);
  const rafRef = useRef<number | null>(null);
  const prevScoreRef = useRef(score);
  const floatIdRef = useRef(0);

  // Count-up toward `score`, settling exactly on the target.
  useEffect(() => {
    const prev = prevScoreRef.current;
    prevScoreRef.current = score;

    // Reset / decrease (e.g. restart): snap immediately, no count-down.
    if (score <= displayedRef.current) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      displayedRef.current = score;
      setDisplayed(score);
      return;
    }

    // Increase: pop + floating "+delta".
    const delta = score - prev;
    if (delta > 0) {
      setPopKey((k) => k + 1);
      const id = ++floatIdRef.current;
      setFloats((f) => [...f, { id, amount: delta }]);
      window.setTimeout(() => {
        setFloats((f) => f.filter((x) => x.id !== id));
      }, 900);
    }

    // Animate the rolling count-up to the exact target (~450ms cap).
    const start = performance.now();
    const from = displayedRef.current;
    const span = score - from;
    const durationMs = 450;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      const value = t >= 1 ? score : Math.round(from + span * eased);
      displayedRef.current = value;
      setDisplayed(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        displayedRef.current = score; // guarantee exact settle
        setDisplayed(score);
      }
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [score]);

  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 text-center select-none">
      <div className="text-[10px] font-semibold tracking-[0.3em] text-white/60 uppercase">
        Score
      </div>
      <div className="relative">
        <div
          key={popKey}
          className={
            "font-mono text-5xl font-black tabular-nums text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" +
            (popKey > 0 ? " animate-score-pop" : "")
          }
        >
          <span data-testid="score">{displayed}</span>
        </div>
        {floats.map((f) => (
          <div
            key={f.id}
            className="animate-score-float absolute top-0 left-1/2 font-mono text-2xl font-black text-[#fff2a8] drop-shadow-[0_0_10px_rgba(255,242,168,0.8)]"
          >
            +{f.amount}
          </div>
        ))}
      </div>
    </div>
  );
}
