"use client";

import { useEffect, useRef, useState } from "react";
import {
  COUNT_UP_MS,
  FLOAT_MS,
  SCORE_DELTA_LIFETIME_MS,
  countUpValue,
  scoreIntensity,
  shouldBurst,
} from "../fx/scoreFx";

interface FloatItem {
  id: number;
  delta: number;
  intensity: number;
}

/**
 * Cosmetic, in-view animated score feedback overlaid on the playfield. It is
 * PURELY presentational: it shows a count-up number, pops/scales on a gain, and
 * spawns a floating "+N" whose size scales with the gain. It never carries the
 * `score` testid — the authoritative value lives in the HUD and updates
 * instantly — so value assertions can never observe a half-counted number.
 */
export function ScoreFx({ score }: { score: number }) {
  const [display, setDisplay] = useState(score);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  // Transient visibility: the count-up number + glow show on a gain and fade out
  // after SCORE_DELTA_LIFETIME_MS. When idle the whole overlay is hidden, leaving
  // only the authoritative HUD score (which lives outside this component).
  const [visible, setVisible] = useState(false);
  const visibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayRef = useRef(score);
  const prevScore = useRef(score);
  const rafRef = useRef<number | null>(null);
  const numRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const prev = prevScore.current;
    prevScore.current = score;

    // Reset or no gain: snap the cosmetic number, fire nothing.
    if (!shouldBurst(prev, score)) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      displayRef.current = score;
      setDisplay(score);
      return;
    }

    // Show the transient and arm its fade-out timer (re-armed on each gain).
    setVisible(true);
    if (visibleTimer.current) clearTimeout(visibleTimer.current);
    visibleTimer.current = setTimeout(
      () => setVisible(false),
      SCORE_DELTA_LIFETIME_MS,
    );

    const delta = score - prev;
    const from = displayRef.current;
    const start = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const tick = (now: number): void => {
      const t = (now - start) / COUNT_UP_MS;
      const v = countUpValue(from, score, t);
      displayRef.current = v;
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        displayRef.current = score;
        setDisplay(score);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    // Pop the number, harder for bigger clears.
    const intensity = scoreIntensity(delta);
    numRef.current?.animate?.(
      [
        {
          transform: `scale(${1.35 + intensity * 0.55})`,
          filter: "brightness(1.9)",
        },
        { transform: "scale(1)", filter: "brightness(1)" },
      ],
      { duration: 260 + intensity * 240, easing: "cubic-bezier(.2,.8,.2,1)" },
    );

    // Floating "+N" indicator.
    const id = ++idRef.current;
    setFloats((f) => [...f, { id, delta, intensity }]);
    const timer = setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, FLOAT_MS);
    return () => clearTimeout(timer);
  }, [score]);

  // Stop any in-flight count-up + fade timer on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (visibleTimer.current) clearTimeout(visibleTimer.current);
    },
    [],
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 text-center transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <div
          ref={numRef}
          className="bg-gradient-to-r from-[#a855f7] via-white to-[#c45cff] bg-clip-text font-mono text-5xl font-black tabular-nums text-transparent"
          style={{
            filter: "drop-shadow(0 0 16px #c45cffaa)",
            willChange: "transform, filter",
          }}
        >
          {display}
        </div>
        {floats.map((f) => (
          <FloatDelta key={f.id} value={f.delta} intensity={f.intensity} />
        ))}
      </div>
    </div>
  );
}

/** A single rising, fading "+N" — animates itself once on mount. */
function FloatDelta({ value, intensity }: { value: number; intensity: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.animate?.(
      [
        { transform: "translate(-50%, 6px) scale(0.7)", opacity: 0, offset: 0 },
        { transform: "translate(-50%, -4px) scale(1)", opacity: 1, offset: 0.18 },
        {
          transform: `translate(-50%, -${44 + intensity * 46}px) scale(${1 + intensity * 0.35})`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: FLOAT_MS, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  }, [intensity]);
  return (
    <div
      ref={ref}
      className="absolute top-1 left-1/2 font-mono font-black text-[#fff2a8]"
      style={{
        transform: "translate(-50%, 6px)",
        fontSize: `${1.2 + intensity * 1.5}rem`,
        textShadow: "0 0 12px #fff2a8cc, 0 0 24px #c45cff88",
        willChange: "transform, opacity",
      }}
    >
      +{value}
    </div>
  );
}
