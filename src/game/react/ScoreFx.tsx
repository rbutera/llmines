"use client";

import { useEffect, useRef, useState } from "react";

/**
 * In-view animated score feedback overlaid on the game canvas. On every scoring
 * event it pops a count-up of the new total in the board centre, floats a "+N"
 * gain chip, bursts themed particles, and flashes the board — all scaled by the
 * size of the gain (big clears land bigger, brighter, and gold).
 *
 * This is purely cosmetic: the authoritative, assertable score lives in the HUD
 * `data-testid="score"` element and is never sourced from here, so the count-up
 * animation can never desync test value assertions.
 */

const COLORS = ["#37e0c9", "#9bf6e8", "#ff5fb0", "#ffc1e3", "#fff2a8"];

interface Particle {
  id: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
}

interface Burst {
  id: number;
  gain: number;
  particles: Particle[];
  flash: number;
  pop: number;
  /** Visual tier by magnitude: 0 normal, 1 big, 2 huge. */
  tier: 0 | 1 | 2;
}

let uid = 0;

function makeBurst(gain: number): Burst {
  const tier: 0 | 1 | 2 = gain >= 24 ? 2 : gain >= 12 ? 1 : 0;
  const count = Math.min(10 + Math.round(gain * 1.3), 40);
  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * (70 + gain * 4);
    return {
      id: uid++,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 4 + Math.random() * (6 + tier * 4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      delay: Math.random() * 90,
      duration: 520 + Math.random() * 360,
    };
  });
  return {
    id: uid++,
    gain,
    particles,
    flash: Math.min(0.18 + gain * 0.02, 0.6),
    pop: 1.3 + Math.min(gain, 40) * 0.012,
    tier,
  };
}

/** Lifetime of a burst overlay (ms) before it is cleaned up. */
const BURST_MS = 1250;

export function ScoreFx({ score }: { score: number }) {
  const [display, setDisplay] = useState(score);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const prevScore = useRef(score);
  const rafRef = useRef<number | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const from = prevScore.current;
    const to = score;
    prevScore.current = to;
    const delta = to - from;

    // Resets / no-ops: snap, don't animate (e.g. restart back to 0).
    if (delta <= 0) {
      setDisplay(to);
      return;
    }

    // Count-up tween from the previous total to the new one (ease-out cubic).
    const duration = Math.min(300 + delta * 15, 1100);
    const startTs = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(to);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    // Spawn the burst overlay and schedule its cleanup.
    const burst = makeBurst(delta);
    setBursts((b) => [...b, burst]);
    const timer = setTimeout(() => {
      setBursts((b) => b.filter((x) => x.id !== burst.id));
      timers.current.delete(timer);
    }, BURST_MS);
    timers.current.add(timer);
  }, [score]);

  // Cleanup any pending rAF / timers on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const active = bursts.length > 0;
  const top = bursts[bursts.length - 1];
  const tierColor =
    top?.tier === 2 ? "#fff2a8" : top?.tier === 1 ? "#9bf6e8" : "#ffffff";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
    >
      {bursts.map((b) => (
        <div key={b.id} className="absolute inset-0">
          {/* Screen flash */}
          <div
            className="score-flash absolute inset-0"
            style={{
              ["--flash" as string]: b.flash,
              animation: `score-flash ${BURST_MS}ms ease-out forwards`,
              background:
                "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.9), rgba(55,224,201,0.25) 45%, transparent 70%)",
            }}
          />
          {/* Particle sparks */}
          <div className="absolute top-1/2 left-1/2">
            {b.particles.map((p) => (
              <span
                key={p.id}
                className="score-spark absolute block rounded-full"
                style={{
                  width: p.size,
                  height: p.size,
                  background: p.color,
                  boxShadow: `0 0 ${p.size * 1.5}px ${p.color}`,
                  ["--dx" as string]: `${p.dx}px`,
                  ["--dy" as string]: `${p.dy}px`,
                  animation: `score-spark ${p.duration}ms cubic-bezier(0.2,0.7,0.3,1) ${p.delay}ms forwards`,
                }}
              />
            ))}
          </div>
          {/* "+N" gain chip */}
          <div
            className="score-gain absolute top-[calc(50%-2.5rem)] left-1/2 font-mono text-2xl font-black tabular-nums sm:text-3xl"
            style={{
              color: b.tier === 2 ? "#fff2a8" : "#37e0c9",
              textShadow: "0 0 18px currentColor",
              animation: `score-gain-rise ${BURST_MS}ms ease-out forwards`,
            }}
          >
            +{b.gain}
          </div>
        </div>
      ))}

      {/* Count-up of the new total, popped in the board centre. */}
      {active && (
        <div
          key={top!.id}
          data-testid="score-fx"
          className="score-burst absolute top-1/2 left-1/2 font-mono text-6xl font-black tabular-nums sm:text-7xl"
          style={{
            color: tierColor,
            ["--pop" as string]: top!.pop,
            textShadow: `0 0 30px ${tierColor}, 0 0 60px ${tierColor}99`,
            animation: `score-burst ${BURST_MS}ms cubic-bezier(0.2,0.8,0.2,1) forwards`,
          }}
        >
          {display}
        </div>
      )}
    </div>
  );
}
