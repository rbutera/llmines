export function Hud({ score }: { score: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
      <span className="text-xs font-semibold uppercase tracking-widest text-cyan-300/80">
        Score
      </span>
      <span
        data-testid="score"
        className="font-mono text-4xl font-bold tabular-nums text-white"
      >
        {score}
      </span>
    </div>
  );
}
