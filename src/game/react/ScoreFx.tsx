"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  BURST_MS,
  scoreTier,
  tierParticleCount,
  tweenValue,
  type ScoreTier,
} from "./score-fx";

const COLOR_A = "#37e0c9"; // cyan
const COLOR_B = "#ff5fb0"; // magenta
const COUNT_UP_MS = 650;

interface Burst {
  id: number;
  gain: number;
  tier: ScoreTier;
  particles: number[];
}

/**
 * Cosmetic, decorative score juice layered over the board. The authoritative
 * value lives elsewhere (the HUD `data-testid="score"`); this overlay only
 * reacts to increases of the `score` prop and never feeds anything back.
 */
export function ScoreFx({ score }: { score: number }) {
  const prevScore = useRef(score);
  const [display, setDisplay] = useState(score);
  const [visible, setVisible] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const rafRef = useRef<number | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const prev = prevScore.current;
    prevScore.current = score;
    if (score <= prev) {
      // Reset / restart (score dropped to 0): snap, no burst.
      setDisplay(score);
      setVisible(false);
      return;
    }

    const gain = score - prev;
    const tier = scoreTier(gain);
    const reduced =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Count-up tween prev -> score on the score-fx element.
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setVisible(true);
    if (reduced) {
      setDisplay(score);
    } else {
      let startTs = 0;
      const step = (ts: number) => {
        if (startTs === 0) startTs = ts;
        const t = Math.min(1, (ts - startTs) / COUNT_UP_MS);
        setDisplay(Math.round(tweenValue(prev, score, t)));
        if (t < 1) rafRef.current = requestAnimationFrame(step);
        else rafRef.current = null;
      };
      rafRef.current = requestAnimationFrame(step);
    }

    // Burst: +N chip, sparks, and a flash for big/huge tiers.
    const id = ++idRef.current;
    const count = reduced ? 0 : tierParticleCount(tier);
    const particles = Array.from({ length: count }, (_, i) => i);
    setBursts((bs) => [...bs, { id, gain, tier, particles }]);
    const burstTimer = setTimeout(() => {
      setBursts((bs) => bs.filter((b) => b.id !== id));
    }, BURST_MS);

    // Hide the count-up after the burst settles.
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setVisible(false), BURST_MS);

    return () => clearTimeout(burstTimer);
  }, [score]);

  // Cancel pending rAF / timers on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  const latest = bursts[bursts.length - 1];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {visible && (
        <div className="absolute inset-x-0 top-6 flex justify-center">
          <span
            key={latest ? latest.id : "idle"}
            data-testid="score-fx"
            className="score-fx-value font-mono text-6xl font-black text-white tabular-nums"
            style={{ textShadow: `0 0 24px ${COLOR_A}, 0 0 48px ${COLOR_B}` }}
          >
            {display}
          </span>
        </div>
      )}

      {bursts.map((b) => (
        <div key={b.id} className="absolute inset-0">
          {b.tier !== "small" && (
            <div
              className="score-fx-flash absolute inset-0"
              style={{
                background:
                  b.tier === "huge"
                    ? "radial-gradient(circle, rgba(255,95,176,0.40), transparent 70%)"
                    : "radial-gradient(circle, rgba(55,224,201,0.30), transparent 70%)",
              }}
            />
          )}

          <div className="absolute inset-x-0 top-24 flex justify-center">
            <span
              className="score-fx-chip font-mono text-2xl font-black"
              style={{ color: b.tier === "huge" ? COLOR_B : COLOR_A }}
            >
              +{b.gain}
            </span>
          </div>

          <div className="absolute top-1/3 left-1/2">
            {b.particles.map((i) => {
              const angle = (360 / b.particles.length) * i;
              const dist =
                60 + (b.tier === "huge" ? 80 : b.tier === "big" ? 40 : 0);
              return (
                <span
                  key={i}
                  className="score-fx-spark absolute block h-2 w-2 rounded-full"
                  style={
                    {
                      background: i % 2 === 0 ? COLOR_A : COLOR_B,
                      "--spark-x": `${Math.cos((angle * Math.PI) / 180) * dist}px`,
                      "--spark-y": `${Math.sin((angle * Math.PI) / 180) * dist}px`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
