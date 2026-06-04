export function GameOverScreen({
  score,
  onRestart,
}: {
  score: number;
  onRestart: () => void;
}) {
  return (
    <div
      data-testid="game-over"
      className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-black/70 px-12 py-10 text-center backdrop-blur-md"
    >
      <h2 className="text-4xl font-black tracking-tight text-white">Game Over</h2>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-widest text-cyan-300/80">
          Final Score
        </span>
        <span className="font-mono text-5xl font-bold tabular-nums text-amber-300">
          {score}
        </span>
      </div>
      <button
        data-testid="restart"
        onClick={onRestart}
        autoFocus
        className="rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-8 py-3 text-lg font-bold text-black shadow-lg shadow-cyan-500/30 transition hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/60"
      >
        Play Again
      </button>
    </div>
  );
}
