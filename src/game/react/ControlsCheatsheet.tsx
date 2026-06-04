const ROWS: { keys: string[]; label: string }[] = [
  { keys: ["h"], label: "move left" },
  { keys: ["l"], label: "move right" },
  { keys: ["j"], label: "soft drop" },
  { keys: ["k"], label: "rotate" },
  { keys: ["space"], label: "hard drop" },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-xs font-semibold text-white shadow-sm">
      {children}
    </kbd>
  );
}

/** The controls legend — shown on the start screen and persistently in-game. */
export function ControlsCheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="controls-cheatsheet"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <h2
        className={`mb-3 font-semibold tracking-wide text-white/70 uppercase ${
          compact ? "text-[11px]" : "text-xs"
        }`}
      >
        Controls
      </h2>
      <ul className="space-y-2">
        {ROWS.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="flex gap-1">
              {r.keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </span>
            <span className="text-white/70">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
