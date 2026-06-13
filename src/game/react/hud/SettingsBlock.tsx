/**
 * Shared cockpit settings block — master volume + audio mute. Used inside the
 * pause overlay. Wires straight to the existing GameShell state (musicVolume /
 * muted) so changing anything here drives the live engine. There is NO skin
 * picker — skins advance only on song completion.
 */

export function SettingsBlock({
  musicVolume,
  onVolumeChange,
  muted,
  onToggleMute,
}: {
  musicVolume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Master volume */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 7,
          }}
        >
          <span className="label">MASTER VOLUME</span>
          <span className="readout" style={{ fontSize: 12 }}>
            {Math.round(musicVolume * 100)}%
          </span>
        </div>
        <input
          className="rng"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={musicVolume}
          aria-label="Music volume"
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>

      {/* Audio: mute */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span className="label">AUDIO</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            data-testid="audio-mute"
            aria-pressed={muted}
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            className={`iconbtn ${muted ? "" : "on"}`}
            style={{ width: 40 }}
            onClick={onToggleMute}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>
    </div>
  );
}
