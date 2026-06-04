const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ["H"], label: "Move left" },
  { keys: ["L"], label: "Move right" },
  { keys: ["J"], label: "Soft drop" },
  { keys: ["K"], label: "Rotate" },
  { keys: ["Space"], label: "Hard drop" },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.9rem] items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 py-1 font-mono text-sm font-semibold text-cyan-100 shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)]">
      {children}
    </kbd>
  );
}

export function ControlsCheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <section
      data-testid="controls-cheatsheet"
      aria-label="Controls and how to play"
      className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
    >
      <h2 className="mb-3 text-xs font-bold tracking-[0.2em] text-cyan-300/80 uppercase">
        Controls
      </h2>
      <ul className="space-y-2">
        {CONTROLS.map((c) => (
          <li
            key={c.label}
            className="flex items-center justify-between gap-4 text-sm text-slate-200"
          >
            <span className="flex gap-1">
              {c.keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </span>
            <span className="text-slate-300">{c.label}</span>
          </li>
        ))}
      </ul>
      {!compact && (
        <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-400">
          Drop 2×2 blocks so four cells of the <em>same colour</em> line up into
          squares. The timeline bar sweeps left→right in time with the music and
          clears every square it crosses. Clear several squares in one sweep for
          a big multiplier. Don&apos;t let the stack reach the top.
        </p>
      )}
    </section>
  );
}
