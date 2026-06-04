export function ControlsCheatsheet() {
  return (
    <section
      className="rounded-lg border border-white/15 bg-black/30 p-4 shadow-2xl shadow-black/20 backdrop-blur"
      data-testid="controls-cheatsheet"
      aria-label="Controls and how to play"
    >
      <h2 className="text-sm font-semibold tracking-[0.18em] text-[#9fffd9] uppercase">
        Controls
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm text-slate-100">
        <div className="flex items-center justify-between gap-3">
          <dt className="font-mono text-[#ffe985]">h</dt>
          <dd>move left</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="font-mono text-[#ffe985]">l</dt>
          <dd>move right</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="font-mono text-[#ffe985]">j</dt>
          <dd>soft-drop</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="font-mono text-[#ffe985]">k</dt>
          <dd>rotate</dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-3">
          <dt className="font-mono text-[#ffe985]">space</dt>
          <dd>hard-drop</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        Drop 2x2 colour blocks, build same-colour 2x2 squares, and let the
        timeline sweep clear marked cells for score.
      </p>
    </section>
  );
}
