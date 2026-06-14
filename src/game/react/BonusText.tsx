"use client";

import { useEffect, useRef, useState } from "react";
import type { GameController, RenderState } from "../engine/controller";
import {
  type BonusKind,
  bonusLabel,
  bonusPointsLabel,
  nextBonusFire,
} from "./bonus-banner";

/**
 * BONUS TEXT overlay — a bold, animated DOM banner that fires when a board-state
 * BONUS clears: "SINGLE COLOUR!" (+1,000) or "ALL CLEAR!" (+10,000). It rides the
 * SAME monotonic `RenderState.lastBonusClear.id` Scene3D uses for the wash, so the
 * text fires EXACTLY ONCE per event (the pure {@link nextBonusFire} decides).
 *
 * A DOM overlay (not in-canvas) so the text stays crisp + trivially animatable.
 * Mounted above the canvas, pointer-events-none so it never eats input.
 *
 * Per-kind treatment (the all-clear is the biggest, most celebratory):
 *   - singleColour: a punchy gold banner — fast scale/pop entrance, brief hold,
 *     a juicy upward exit.
 *   - allClear: the crown jewel — a bigger, shimmering rainbow headline that
 *     SLAMS in with an over-scale + flash, holds longer, and blasts out.
 *
 * a11y: no harsh strobe; under `prefers-reduced-motion: reduce` the banner skips
 * the slam/shimmer and just fades in/out gently.
 */

interface Banner {
  /** Fire id — also the React key so each fire mounts a fresh, self-animating banner. */
  id: number;
  kind: BonusKind;
}

export function BonusText({ controller }: { controller: GameController }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const lastFiredRef = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = controller.subscribe((rs: RenderState) => {
      const decision = nextBonusFire(rs.lastBonusClear, lastFiredRef.current);
      lastFiredRef.current = decision.lastFiredId;
      if (decision.fire && decision.kind) {
        const id = decision.lastFiredId;
        const kind = decision.kind;
        setBanner({ id, kind });
        // Lifetime: all-clear lingers longer (the big celebration).
        const life = kind === "allClear" ? 2200 : 1500;
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => {
          // Only clear if this is still the banner showing (a newer one supersedes).
          setBanner((b) => (b?.id === id ? null : b));
        }, life);
      }
    });
    return () => {
      unsub();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [controller]);

  return (
    <div
      aria-hidden
      data-testid="bonus-text-layer"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden"
    >
      {banner && (
        <BonusBanner key={banner.id} kind={banner.kind} />
      )}
    </div>
  );
}

/** A single bonus banner — animates itself once on mount, per kind. */
function BonusBanner({ kind }: { kind: BonusKind }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isAllClear = kind === "allClear";

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      // Reduced motion: a gentle fade in -> hold -> fade out. No slam, no shimmer.
      const life = isAllClear ? 2200 : 1500;
      el.animate?.(
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, offset: 0.82 },
          { opacity: 0, offset: 1 },
        ],
        { duration: life, easing: "ease" },
      );
      return;
    }

    if (isAllClear) {
      // ALL CLEAR — the crown jewel: a hard SLAM-in over-scale + flash, a long
      // confident hold, then a powerful blast-out.
      el.animate?.(
        [
          {
            transform: "translateY(8px) scale(0.4)",
            opacity: 0,
            filter: "brightness(2.4)",
            offset: 0,
          },
          {
            transform: "translateY(0) scale(1.28)",
            opacity: 1,
            filter: "brightness(1.9)",
            offset: 0.12,
          },
          {
            transform: "translateY(0) scale(1)",
            opacity: 1,
            filter: "brightness(1)",
            offset: 0.24,
          },
          {
            transform: "translateY(0) scale(1.04)",
            opacity: 1,
            filter: "brightness(1.15)",
            offset: 0.78,
          },
          {
            transform: "translateY(-26px) scale(1.5)",
            opacity: 0,
            filter: "brightness(2)",
            offset: 1,
          },
        ],
        { duration: 2200, easing: "cubic-bezier(.18,.9,.2,1)" },
      );
    } else {
      // SINGLE COLOUR — punchy gold: a snappy pop-in, brief hold, juicy lift-out.
      el.animate?.(
        [
          {
            transform: "translateY(6px) scale(0.55)",
            opacity: 0,
            filter: "brightness(2)",
            offset: 0,
          },
          {
            transform: "translateY(0) scale(1.16)",
            opacity: 1,
            filter: "brightness(1.5)",
            offset: 0.16,
          },
          {
            transform: "translateY(0) scale(1)",
            opacity: 1,
            filter: "brightness(1)",
            offset: 0.3,
          },
          {
            transform: "translateY(-18px) scale(1.22)",
            opacity: 0,
            filter: "brightness(1.6)",
            offset: 1,
          },
        ],
        { duration: 1500, easing: "cubic-bezier(.2,.85,.2,1)" },
      );
    }
  }, [isAllClear]);

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-center text-center"
      style={{ opacity: 0, willChange: "transform, opacity, filter" }}
    >
      <div
        className={
          isAllClear
            ? "font-mono font-black tracking-tight bg-clip-text text-transparent"
            : "font-mono font-black tracking-tight text-transparent bg-clip-text"
        }
        style={{
          fontSize: isAllClear
            ? "clamp(2.6rem, 9vw, 6.5rem)"
            : "clamp(1.9rem, 6.5vw, 4.5rem)",
          backgroundImage: isAllClear
            ? "linear-gradient(100deg,#fff 0%,#aef1ff 22%,#ffd2f7 46%,#fff6a8 70%,#fff 100%)"
            : "linear-gradient(100deg,#ffe9a8 0%,#fff 30%,#ffc23f 60%,#ff9b2f 100%)",
          filter: isAllClear
            ? "drop-shadow(0 0 26px #bfe9ffcc) drop-shadow(0 0 54px #ffd2f7aa)"
            : "drop-shadow(0 0 20px #ffc23faa) drop-shadow(0 0 40px #ff9b2f88)",
        }}
      >
        {bonusLabel(kind)}
      </div>
      <div
        className="font-mono font-black tabular-nums"
        style={{
          marginTop: isAllClear ? "0.15em" : "0.1em",
          fontSize: isAllClear
            ? "clamp(1.6rem, 5vw, 3.6rem)"
            : "clamp(1.2rem, 3.5vw, 2.6rem)",
          color: isAllClear ? "#fff6c8" : "#fff2c0",
          textShadow: isAllClear
            ? "0 0 18px #fff6c8cc, 0 0 36px #ffd2f7aa"
            : "0 0 14px #ffe9a8cc, 0 0 28px #ff9b2f88",
        }}
      >
        {bonusPointsLabel(kind)}
      </div>
    </div>
  );
}
