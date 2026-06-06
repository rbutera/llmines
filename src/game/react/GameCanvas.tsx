"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { GameController } from "../engine/controller";
import { PixiRenderer } from "../render/renderer";

interface ScoreParticle {
  id: number;
  dx: string;
  dy: string;
  size: number;
  color: string;
  delayMs: number;
}

interface ScoreBurst {
  id: number;
  delta: number;
  big: boolean;
  particles: ScoreParticle[];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function buildParticles(delta: number): ScoreParticle[] {
  const count = Math.min(30, 12 + Math.floor(delta / 2));
  const colors = ["#fff2a8", "#37e0c9", "#ff5fb0", "#ffffff"];
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    const distance = 72 + ((i * 37) % 64) + Math.min(delta, 36) * 2;
    return {
      id: i,
      dx: `${Math.cos(angle) * distance}px`,
      dy: `${Math.sin(angle) * distance}px`,
      size: 5 + ((i * 5) % 9),
      color: colors[i % colors.length]!,
      delayMs: (i % 5) * 18,
    };
  });
}

/**
 * Mounts the PixiJS renderer into a ref'd container and wires it to the
 * controller. The Pixi app is created on mount and fully destroyed on unmount
 * (StrictMode double-invoke safe — async init checks a destroyed flag).
 */
export function GameCanvas({
  controller,
  score,
}: {
  controller: GameController;
  score: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const prevScoreRef = useRef(score);
  const rafRef = useRef<number | null>(null);
  const clearBurstRef = useRef<number | null>(null);
  const [displayScore, setDisplayScore] = useState(score);
  const [burst, setBurst] = useState<ScoreBurst | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new PixiRenderer();
    let cancelled = false;
    void renderer.init(host).then(() => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      renderer.attach(controller);
    });
    return () => {
      cancelled = true;
      renderer.destroy();
    };
  }, [controller]);

  useEffect(() => {
    const from = prevScoreRef.current;
    if (score === from) return;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (clearBurstRef.current !== null)
      window.clearTimeout(clearBurstRef.current);

    if (score < from) {
      prevScoreRef.current = score;
      setDisplayScore(score);
      setBurst(null);
      return;
    }

    const delta = score - from;
    const started = performance.now();
    const duration = Math.min(950, 520 + delta * 18);
    const id = started;

    setBurst({
      id,
      delta,
      big: delta >= 8,
      particles: buildParticles(delta),
    });

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setDisplayScore(Math.round(from + delta * easeOutCubic(t)));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        setDisplayScore(score);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    clearBurstRef.current = window.setTimeout(() => {
      setBurst(null);
      clearBurstRef.current = null;
    }, 980);
    prevScoreRef.current = score;

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (clearBurstRef.current !== null)
        window.clearTimeout(clearBurstRef.current);
      rafRef.current = null;
      clearBurstRef.current = null;
    };
  }, [score]);

  const badgeClass = useMemo(
    () =>
      burst
        ? "llmines-score-badge llmines-score-badge-hit"
        : "llmines-score-badge",
    [burst],
  );

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
      style={{ aspectRatio: "16 / 10", boxShadow: "0 0 60px -15px #37e0c980" }}
    >
      <div aria-hidden className={badgeClass}>
        <span className="llmines-score-badge-label">Score</span>
        <span className="llmines-score-badge-value">{displayScore}</span>
      </div>

      {burst && (
        <div
          key={burst.id}
          aria-hidden
          data-testid="score-burst"
          className="llmines-score-burst"
        >
          <div className="llmines-score-flash" />
          <div className="llmines-score-ring" />
          <div
            className={
              burst.big
                ? "llmines-score-pop llmines-score-pop-big"
                : "llmines-score-pop"
            }
          >
            +{burst.delta}
          </div>
          <div className="llmines-score-count">{displayScore}</div>
          {burst.particles.map((p) => (
            <span
              key={p.id}
              className="llmines-score-particle"
              style={
                {
                  "--dx": p.dx,
                  "--dy": p.dy,
                  "--particle-color": p.color,
                  width: p.size,
                  height: p.size,
                  animationDelay: `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
