/**
 * Shared cockpit settings block — master volume, audio mute, and skin swatches.
 * Used inside the pause overlay. Wires straight to the existing GameShell state
 * (musicVolume / muted / skin), so changing anything here drives the live engine +
 * the whole-scene re-tint exactly as the always-on controls did.
 */

import { SKINS } from "../../skins/skins";
import { hudHueForSkin } from "../../theme/tokens";

export function SettingsBlock({
  musicVolume,
  onVolumeChange,
  muted,
  onToggleMute,
  skinId,
  onSelectSkin,
}: {
  musicVolume: number;
  onVolumeChange: (v: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  skinId: string;
  onSelectSkin: (id: string) => void;
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

      {/* Skin swatches */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span className="label">SKIN</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {SKINS.map((s) => {
            const { hue, chroma } = hudHueForSkin(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={skinId === s.id}
                aria-label={`Skin ${s.label}`}
                className={`swatch ${skinId === s.id ? "on" : ""}`}
                style={{ background: `oklch(0.74 ${chroma} ${hue})` }}
                title={s.label}
                onClick={() => onSelectSkin(s.id)}
              />
            );
          })}
          <span
            className="cap-tight glow-text"
            style={{ fontSize: 11, width: 80 }}
          >
            {SKINS.find((s) => s.id === skinId)?.label ?? skinId}
          </span>
        </div>
      </div>
    </div>
  );
}
