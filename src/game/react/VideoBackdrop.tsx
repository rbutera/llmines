"use client";

import { useEffect, useRef } from "react";
import { COLS } from "../core";
import type { GameController, RenderState } from "../engine/controller";
import { SKINS } from "../skins/skins";

/**
 * Full-viewport VIDEO BACKDROP (Lumines Arise style): a per-skin looping clip
 * behind the floating board, with:
 *   - PARALLAX: the clip shifts horizontally as the active piece translates on the
 *     x-axis (subtle, opposite direction, smoothed) — driven by the controller's
 *     RenderState `active.pos.col`, applied straight to the DOM transform off the
 *     React render path.
 *   - SKIN COUPLING: the active skin's clip is shown; the other is faded out.
 *   - TRANSITION: the `transition.mp4` clip plays once over the top on a skin
 *     switch, then fades out to reveal the new skin's loop underneath.
 * A dim scrim keeps the board the hero (the backdrop never competes for attention).
 */

/** Skin id → looping background clip. */
const SKIN_VIDEO: Record<string, string> = {
  neon: "/video/skin1-background.mp4",
  pipeline: "/video/skin2-background.mp4",
};
const TRANSITION_VIDEO = "/video/transition.mp4";
/** Reversed transition — played when the cycle WRAPS BACK (last skin → first). */
const TRANSITION_REVERSE_VIDEO = "/video/transition-reverse.mp4";
const skinOrder = (id: string) => SKINS.findIndex((s) => s.id === id);

/** Max horizontal parallax shift (% of the clip) at the board's edge columns. */
const MAX_SHIFT_PCT = 3.5;
/** Overscan so the parallax shift never reveals a clip edge. */
const OVERSCAN = 1.14;

export function VideoBackdrop({
  controller,
  skinId,
}: {
  controller: GameController | null;
  /** Active skin id (drives which loop shows + triggers the transition clip). */
  skinId: string;
}) {
  // The parallax-translated container (holds both looping clips).
  const parallaxRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<HTMLVideoElement>(null);
  const prevSkinRef = useRef(skinId);

  // PARALLAX: subscribe to the controller and map the active piece's column to a
  // small horizontal shift. Direct DOM writes (no React re-render); a CSS
  // transition on the element smooths the discrete column jumps.
  useEffect(() => {
    if (!controller) return;
    const unsub = controller.subscribe((rs: RenderState) => {
      const el = parallaxRef.current;
      if (!el) return;
      const col = rs.active?.pos.col;
      const center = (COLS - 1) / 2;
      // No active piece → settle to centre.
      const norm = col == null ? 0 : (col - center) / center; // -1..1
      const shift = -norm * MAX_SHIFT_PCT; // background drifts OPPOSITE the piece
      el.style.transform = `scale(${OVERSCAN}) translateX(${shift}%)`;
    });
    return unsub;
  }, [controller]);

  // TRANSITION: on a skin change, play the transition clip once on top, then fade
  // it out to reveal the (already-swapped) new skin loop underneath.
  useEffect(() => {
    const prev = prevSkinRef.current;
    if (prev === skinId) return;
    // Direction: wrapping BACK (last skin → first, e.g. pipeline → neon) plays the
    // transition REVERSED so the cycle reads as returning to song 1; forward
    // advances play it normally. Infinite loop: songs cycle endlessly either way.
    const wrappingBack = skinOrder(skinId) < skinOrder(prev);
    prevSkinRef.current = skinId;
    const v = transitionRef.current;
    if (!v) return;
    try {
      v.src = wrappingBack ? TRANSITION_REVERSE_VIDEO : TRANSITION_VIDEO;
      v.currentTime = 0;
      v.style.opacity = "1";
      void v.play();
      const onEnd = () => {
        v.style.opacity = "0";
        v.removeEventListener("ended", onEnd);
      };
      v.addEventListener("ended", onEnd);
    } catch {
      // best-effort; the loop swap below still happens
    }
  }, [skinId]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#000",
        pointerEvents: "none",
      }}
    >
      <div
        ref={parallaxRef}
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${OVERSCAN})`,
          transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {Object.entries(SKIN_VIDEO).map(([id, src]) => (
          <video
            key={id}
            src={src}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: id === skinId ? 1 : 0,
              transition: "opacity 1s ease",
            }}
          />
        ))}
      </div>

      {/* Transition clip — overlaid on top, played once per skin switch. Its `src`
          is set imperatively (forward vs reversed) on each switch, so no JSX src. */}
      <video
        ref={transitionRef}
        muted
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0,
          transition: "opacity 0.6s ease",
        }}
      />

      {/* Dim scrim — light touch so the video reads clearly THROUGH the playfield
          (the board is transparent; the pieces' own bloom keeps them the hero). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 120% at 50% 50%, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.4) 100%)",
        }}
      />
    </div>
  );
}
