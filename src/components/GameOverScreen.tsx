"use client";

interface GameOverScreenProps {
  score: number;
  onRestart: () => void;
  visible: boolean;
}

export function GameOverScreen({ score, onRestart, visible }: GameOverScreenProps) {
  return (
    <div
      data-testid="game-over"
      className={`absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex flex-col items-center gap-6 rounded-xl border border-white/10 bg-[#0a0a1a]/90 px-10 py-8 text-center shadow-2xl">
        <h2 className="text-3xl font-bold text-white">Game Over</h2>

        <div className="space-y-1">
          <p className="text-sm text-white/50 uppercase tracking-wider">Final Score</p>
          <p
            data-testid="final-score"
            className="text-5xl font-bold text-[#ff6b9d]"
          >
            {score}
          </p>
        </div>

        <button
          data-testid="restart"
          onClick={onRestart}
          className="mt-2 rounded-lg bg-gradient-to-r from-[#4ecdc4] to-[#44a08d] px-8 py-3 text-lg font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-cyan-400"
          autoFocus
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
