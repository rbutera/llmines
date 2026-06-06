"use client";

interface ControlsCheatsheetProps {
  compact?: boolean;
}

const controls = [
  { key: "H / ←", action: "Move Left" },
  { key: "L / →", action: "Move Right" },
  { key: "J / ↓", action: "Soft Drop" },
  { key: "K / ↑", action: "Rotate" },
  { key: "Space", action: "Hard Drop" },
];

export function ControlsCheatsheet({ compact }: ControlsCheatsheetProps) {
  return (
    <div
      data-testid="controls-cheatsheet"
      className={`rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm ${
        compact ? "px-3 py-2" : "px-6 py-4"
      }`}
    >
      {!compact && (
        <h3 className="mb-3 text-center text-sm font-semibold tracking-wider text-white/60 uppercase">
          Controls
        </h3>
      )}
      <div className={`grid gap-1.5 ${compact ? "text-xs" : "text-sm"}`}>
        {controls.map(({ key, action }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <kbd
              className={`rounded bg-white/10 font-mono text-white/90 ${
                compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
              }`}
            >
              {key}
            </kbd>
            <span className="text-white/60">{action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
