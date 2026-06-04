const CONTROLS: { keys: string; action: string }[] = [
  { keys: "H", action: "Move left" },
  { keys: "L", action: "Move right" },
  { keys: "J", action: "Soft drop" },
  { keys: "K", action: "Rotate" },
  { keys: "Space", action: "Hard drop" },
];

export function ControlsCheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <section
      data-testid="controls-cheatsheet"
      aria-label="Controls"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-cyan-300/80">
        Controls
      </h2>
      <ul className="flex flex-col gap-2">
        {CONTROLS.map(({ keys, action }) => (
          <li key={keys} className="flex items-center justify-between gap-4 text-sm">
            <kbd className="min-w-[3.25rem] rounded-md border border-white/20 bg-black/40 px-2 py-1 text-center font-mono text-xs text-amber-200 shadow-inner">
              {keys}
            </kbd>
            <span className="text-white/80">{action}</span>
          </li>
        ))}
      </ul>
      {!compact && (
        <p className="mt-4 text-xs leading-relaxed text-white/50">
          Stack the falling 2&times;2 blocks so four same-coloured cells form a
          square. The timeline bar sweeps in time with the music and clears every
          marked square it passes &mdash; clear more at once to multiply your score.
          Arrow keys also work.
        </p>
      )}
    </section>
  );
}
