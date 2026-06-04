import { ControlsPanel } from "./ControlsPanel";

export function GameHud({ score }: { score: number }) {
  return (
    <aside className="hud" aria-label="Game status">
      <div className="score-panel">
        <span className="score-label">Score</span>
        <span data-testid="score" className="score-value">
          {score}
        </span>
      </div>
      <ControlsPanel compact />
    </aside>
  );
}
