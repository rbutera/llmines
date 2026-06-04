export function ControlsPanel({ compact = false }: { compact?: boolean }) {
  return (
    <section
      data-testid="controls-cheatsheet"
      className={compact ? "controls controls--compact" : "controls"}
      aria-label="Controls and how to play"
    >
      <div>
        <h2>Controls</h2>
        <dl className="control-grid">
          <div>
            <dt>h / left</dt>
            <dd>Move left</dd>
          </div>
          <div>
            <dt>l / right</dt>
            <dd>Move right</dd>
          </div>
          <div>
            <dt>j / down</dt>
            <dd>Soft drop</dd>
          </div>
          <div>
            <dt>k / up</dt>
            <dd>Rotate</dd>
          </div>
          <div>
            <dt>space</dt>
            <dd>Hard drop</dd>
          </div>
        </dl>
      </div>
      <p>
        Build same-color 2x2 squares. The timeline sweeps across the field,
        clears marked cells, drops the stack, and scores bigger passes higher.
      </p>
    </section>
  );
}
