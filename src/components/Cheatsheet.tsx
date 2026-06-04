const ROWS: { keys: string; action: string }[] = [
  { keys: "h", action: "Move left" },
  { keys: "l", action: "Move right" },
  { keys: "j", action: "Soft drop" },
  { keys: "k", action: "Rotate" },
  { keys: "space", action: "Hard drop" },
];

export function Cheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="controls-cheatsheet"
      className={`rounded-lg border border-white/10 bg-white/5 p-4 ${
        compact ? "text-sm" : ""
      }`}
    >
      <h3 className="mb-2 font-semibold tracking-wide text-white/80">Controls</h3>
      <ul className="space-y-1">
        {ROWS.map((r) => (
          <li key={r.keys} className="flex items-center justify-between gap-4">
            <kbd className="rounded bg-black/40 px-2 py-0.5 font-mono text-cyan-200">
              {r.keys}
            </kbd>
            <span className="text-white/70">{r.action}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-white/50">
        Build same-colour 2×2 squares. The light bar sweeps left→right in time
        with the music and clears every square it crosses.
      </p>
    </div>
  );
}
