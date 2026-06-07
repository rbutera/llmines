"use client";

// Controls legend + brief how-to-play (Req 12.1, 12.2, 20.5).
//
// Presentational only. The same component is shown on the Start_Screen and
// persistently in the In_Game_View. The content is always visible; the
// `data-testid="controls-cheatsheet"` attribute is emitted only in Test_Mode
// (Req 20.5) via the shared `tid` helper. Only one screen renders at a time, so
// at most one cheatsheet (and one test hook) is in the DOM.

import { tid } from "~/app/_game/testMode";

/** A single control row: a key chip and its action. */
interface ControlRow {
  keys: string[];
  action: string;
}

const CONTROLS: ControlRow[] = [
  { keys: ["h"], action: "move left" },
  { keys: ["l"], action: "move right" },
  { keys: ["j"], action: "soft drop" },
  { keys: ["k"], action: "rotate" },
  { keys: ["space"], action: "hard drop" },
];

/** A styled keyboard key chip. */
function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 py-1 font-mono text-sm font-semibold text-white shadow-sm">
      {children}
    </kbd>
  );
}

export interface ControlsCheatsheetProps {
  /** Extra classes for layout (the parent positions the panel). */
  className?: string;
}

/**
 * The controls legend and a short how-to-play blurb. Styled as a translucent
 * panel with key chips so it reads cleanly on both the start and in-game
 * screens (Req 14.4).
 */
export function ControlsCheatsheet({
  className,
}: ControlsCheatsheetProps): React.JSX.Element {
  return (
    <section
      {...tid("controls-cheatsheet")}
      className={
        "rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm " +
        (className ?? "")
      }
      aria-label="Controls and how to play"
    >
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/70 uppercase">
        Controls
      </h2>
      <ul className="space-y-2">
        {CONTROLS.map((row) => (
          <li
            key={row.action}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex gap-1">
              {row.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span className="text-sm text-white/80">{row.action}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-white/50">
        Arrow keys mirror these: ← / → move, ↓ soft drop, ↑ rotate.
      </p>

      <h2 className="mt-4 mb-2 text-sm font-semibold tracking-wide text-white/70 uppercase">
        How to play
      </h2>
      <p className="text-sm leading-relaxed text-white/70">
        Form same-colour 2×2 squares from the falling blocks. The timeline bar
        sweeps left to right and clears every marked square it passes. Your
        score grows by cells cleared × squares cleared, so build big monochrome
        regions before the bar arrives.
      </p>
    </section>
  );
}

export default ControlsCheatsheet;
