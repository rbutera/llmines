"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

interface ScoreEvent {
  id: number;
  from: number;
  to: number;
  delta: number;
  intensity: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
}

function intensityFor(delta: number): number {
  if (delta >= 20) return 3;
  if (delta >= 8) return 2;
  return 1;
}

function particlesFor(event: ScoreEvent): Particle[] {
  const count = 7 + event.intensity * 5;
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    const distance = 34 + event.intensity * 13 + (i % 3) * 9;
    return {
      id: event.id * 100 + i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      dx: Math.cos(angle) * (18 + event.intensity * 8),
      dy: Math.sin(angle) * (18 + event.intensity * 8),
      size: 5 + event.intensity * 2 + (i % 2) * 2,
    };
  });
}

export function ScoreFeedback({ score }: { score: number }) {
  const previousScore = useRef(score);
  const eventId = useRef(0);
  const [displayScore, setDisplayScore] = useState(score);
  const [event, setEvent] = useState<ScoreEvent | null>(null);

  useEffect(() => {
    const from = previousScore.current;
    if (score <= from) {
      previousScore.current = score;
      setDisplayScore(score);
      setEvent(null);
      return;
    }

    const nextEvent: ScoreEvent = {
      id: ++eventId.current,
      from,
      to: score,
      delta: score - from,
      intensity: intensityFor(score - from),
    };
    previousScore.current = score;
    setEvent(nextEvent);

    const durationMs = 520 + nextEvent.intensity * 140;
    const startedAt = performance.now();
    let raf = 0;
    let timeout = 0;

    const frame = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(nextEvent.from + nextEvent.delta * eased));
      if (t < 1) raf = requestAnimationFrame(frame);
      else setDisplayScore(nextEvent.to);
    };

    raf = requestAnimationFrame(frame);
    timeout = window.setTimeout(
      () =>
        setEvent((current) => (current?.id === nextEvent.id ? null : current)),
      durationMs + 700,
    );

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [score]);

  const particles = useMemo(() => (event ? particlesFor(event) : []), [event]);

  return (
    <div
      aria-hidden
      data-testid="score-feedback"
      data-active={event ? "true" : "false"}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {event && (
        <div
          key={event.id}
          data-testid="score-feedback-effect"
          data-score-delta={event.delta}
          data-intensity={event.intensity}
          className={`score-feedback score-feedback-intensity-${event.intensity}`}
        >
          <div className="score-feedback-flash" />
          <div className="score-feedback-burst">
            {particles.map((particle) => (
              <span
                key={particle.id}
                data-testid="score-feedback-particle"
                className="score-feedback-particle"
                style={
                  {
                    "--x": `${particle.x}px`,
                    "--y": `${particle.y}px`,
                    "--dx": `${particle.dx}px`,
                    "--dy": `${particle.dy}px`,
                    "--size": `${particle.size}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="score-feedback-readout">
            <div
              data-testid="score-feedback-value"
              className="score-feedback-value"
            >
              {displayScore}
            </div>
            <div
              data-testid="score-feedback-delta"
              className="score-feedback-delta"
            >
              +{event.delta}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
