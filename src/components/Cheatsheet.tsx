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
      className={`w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_0_40px_-20px_rgba(76,194,255,0.5)] backdrop-blur-sm ${
        compact ? "text-sm" : ""
      }`}
    >
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
        Controls
      </h3>
      <ul className="space-y-1.5">
        {ROWS.map((r) => (
          <li key={r.keys} className="flex items-center justify-between gap-4">
            <kbd className="rounded-md border border-cyan-300/20 bg-black/40 px-2 py-0.5 font-mono text-cyan-200 shadow-[0_0_12px_-4px_rgba(76,194,255,0.6)]">
              {r.keys}
            </kbd>
            <span className="text-white/70">{r.action}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-white/45">
        Build same-colour 2×2 squares. The light bar sweeps left→right in time
        with the music and clears every square it crosses.
      </p>
    </div>
  );
}
