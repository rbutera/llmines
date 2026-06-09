#!/usr/bin/env python3
"""
Wave-1 cut + tier-render for the LLMines audio redesign.

Reads cut-plan.json (bar-snapped segments) and the native stems, groups stems
into the locked 4-layer model, and renders per-segment tiered beds:

  tier0 = L1            (bass + perc/drums)            -- always-on bed
  tier1 = L1 + L2       (+ instrumentation)            -- first reveal
  tier2 = L1 + L2 + L3  (+ vocals)                     -- full arrangement

LOOPER segments: whole-bar window, 200ms equal-power crossfade-WRAP so the file
loops seamlessly (head mixed into tail; seam RMS ~ 0).
PROGRESSION / TERMINAL segments: whole-bar window + a spill-aware tail (extra
bars of vocal/instrument decay past the boundary so phrases are not chopped),
play-through (no wrap).

Every rendered tier is loudness-normalized to ~-14 LUFS (EBU R128 via ffmpeg
loudnorm). Stems are summed in float; sums are peak-guarded before loudnorm.

Layer 4 (SFX) is rendered by render-sfx.py, not here.

Outputs: build/wav/<song>/<segid>-tier{0,1,2}.wav  (intermediate, gitignored)
         build-reports/render-report.json

Run: .venv-audio/bin/python scripts/audio/render-tiers.py
"""
import json
import os
import subprocess
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT_WAV = os.path.join(ROOT, "build", "wav")
REPORTS = os.path.join(ROOT, "build-reports")
FFMPEG = "/opt/homebrew/bin/ffmpeg"

SR = 48000
# Loop wrap crossfade length. A longer (beat-scale) equal-power wrap smooths
# melodic seams far better than 200ms; we use one beat, clamped to 25% of the
# loop and to the available pre-roll. Reported per-tier in the loop check.
WRAP_MS = 200          # floor
WRAP_BEATS = 1.0       # target wrap length in beats (beat = secPerBar / 4)
TARGET_LUFS = -14.0

# Layer grouping (validated). song2 Backing_Vocals dropped: it is silent
# (loudest 1s = -56 dB RMS, 1/196 frames above -60 dB) -> L3 = lead vocal only.
LAYERS = {
    "song1": {
        "L1": ["5 Bass.wav", "6 Drums.wav", "3 Percussion.wav"],
        "L2": ["2 Synth.wav", "4 Guitar.wav", "1 FX.wav"],
        "L3": ["7 Vocals.wav"],
    },
    "song2": {
        "L1": ["3 Bass.wav", "4 Drums.wav"],
        "L2": ["2 Synth.wav", "1 FX.wav"],
        "L3": ["6 Vocals.wav"],  # 5 Backing_Vocals.wav dropped (silent)
    },
}

# spill tail for play-through segments (bars of decay past the boundary)
SPILL_BARS = 1


def load_stem(song, name):
    d, sr = sf.read(os.path.join(SRC, song, name), dtype="float32", always_2d=True)
    assert sr == SR, f"{name} sr {sr} != {SR}"
    return d


def sum_layers(stems, names):
    acc = None
    for n in names:
        d = stems[n]
        acc = d.copy() if acc is None else acc + d
    return acc


def bar_to_sample(bar, sec_per_bar, origin):
    return int(round((origin + bar * sec_per_bar) * SR))


def equal_power_wrap(full, i0, i1, wrap_samples):
    """Build a seamless bar-loop of the window full[i0:i1].

    Standard overlap-add loop: render the window PLUS an overshoot of w samples
    past the end (full[i1:i1+w], the natural continuation of the music), then
    crossfade that overshoot OVER the first w samples of the window:

        seg[0:w] = head[0:w] * fade_in  +  overshoot[0:w] * fade_out

    Because the overshoot is the real continuous audio that follows seg[-1], the
    blended head now flows seamlessly out of the loop's tail: playing
    ...seg[-1] -> seg[0]... reproduces the original continuous waveform across
    the join (equal-power, so constant power through the crossfade). The window
    body and tail are untouched, so the loop length stays exactly whole-bar.

    Returned length == window length (i1 - i0). If no overshoot exists (window
    runs to end of track), falls back to crossfading the pre-roll over the tail.
    """
    n = i1 - i0
    w = min(wrap_samples, n // 4)
    if w < 1:
        return full[i0:i1].copy()
    t = np.linspace(0, np.pi / 2, w, dtype=np.float32)[:, None]
    fade_in = np.sin(t)   # window head coming in
    fade_out = np.cos(t)  # overshoot (tail continuation) going out
    seg = full[i0:i1].copy()
    if i1 + w <= full.shape[0]:
        overshoot = full[i1:i1 + w].copy()  # natural continuation after seg[-1]
        seg[:w] = seg[:w] * fade_in + overshoot * fade_out
    elif i0 - w >= 0:
        # no room after end: crossfade pre-roll (lead-in) over the tail instead
        preroll = full[i0 - w:i0].copy()
        seg[n - w:] = seg[n - w:] * np.cos(t) + preroll * np.sin(t)
    return seg


def peak_guard(buf, ceiling=0.97):
    peak = float(np.abs(buf).max())
    if peak > ceiling:
        buf = buf * (ceiling / peak)
    return buf, peak


def write_wav(path, buf):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, buf, SR, subtype="FLOAT")


def loudnorm(in_path, out_path, target=TARGET_LUFS):
    """Single-pass EBU R128 loudnorm to target LUFS. Writes 24-bit WAV."""
    cmd = [
        FFMPEG, "-y", "-v", "error", "-i", in_path,
        "-af", f"loudnorm=I={target}:TP=-1.5:LRA=11",
        "-ar", str(SR), "-c:a", "pcm_s24le", out_path,
    ]
    subprocess.run(cmd, check=True)


def measure_lufs(path):
    """Two-pass-style measurement via loudnorm print_format=json (analysis only)."""
    cmd = [FFMPEG, "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    err = p.stderr
    try:
        start = err.rindex("{")
        end = err.rindex("}") + 1
        j = json.loads(err[start:end])
        return float(j.get("input_i", 0.0))
    except Exception:  # noqa: BLE001
        return None


def main():
    with open(os.path.join(ROOT, "scripts", "audio", "cut-plan.json")) as f:
        plan = json.load(f)

    report = {"songs": {}}
    for song in ("song1", "song2"):
        sp = plan[song]
        spb, origin = sp["secPerBar"], sp["origin"]
        # load all needed stems once
        needed = set()
        for names in LAYERS[song].values():
            needed.update(names)
        stems = {n: load_stem(song, n) for n in needed}
        L1 = sum_layers(stems, LAYERS[song]["L1"])
        L2 = sum_layers(stems, LAYERS[song]["L2"])
        L3 = sum_layers(stems, LAYERS[song]["L3"])
        total_len = L1.shape[0]

        song_rep = {"segments": []}
        for seg in sp["segments"]:
            sb, eb = seg["startBar"], seg["endBar"]
            bars = eb - sb + 1
            i0 = bar_to_sample(sb, spb, origin)
            # window end = exclusive end of endBar (i.e. start of endBar+1)
            i1 = bar_to_sample(eb + 1, spb, origin)
            is_loop = seg["type"] == "LOOPER"
            spill = 0
            if not is_loop:
                spill_end = bar_to_sample(eb + 1 + SPILL_BARS, spb, origin)
                spill = min(spill_end, total_len) - i1
                i1_full = min(spill_end, total_len)
            else:
                i1_full = i1
            i1 = min(i1, total_len)
            i1_full = min(i1_full, total_len)

            full_by_tier = {
                "tier0": L1,
                "tier1": L1 + L2,
                "tier2": L1 + L2 + L3,
            }
            beat_s = spb / 4.0
            wrap_n = int(max(WRAP_MS / 1000.0, WRAP_BEATS * beat_s) * SR)

            seg_rep = {
                "id": seg["id"], "type": seg["type"], "bars": bars,
                "startSec": round(i0 / SR, 4),
                "barWindowSec": round((i1 - i0) / SR, 4),
                "spillSec": round(spill / SR, 4),
                "tiers": {},
            }
            for tname, full_buf in full_by_tier.items():
                if is_loop:
                    # whole-bar loop: window [i0,i1], seam crossfaded with pre-roll
                    buf = equal_power_wrap(full_buf, i0, i1, wrap_n)
                else:
                    buf = full_buf[i0:i1_full].copy()
                buf, raw_peak = peak_guard(buf)
                raw_path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tname}.raw.wav")
                norm_path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tname}.wav")
                write_wav(raw_path, buf)
                loudnorm(raw_path, norm_path)
                os.remove(raw_path)
                seg_rep["tiers"][tname] = {
                    "wav": norm_path,
                    "rawPeakDb": round(20 * np.log10(raw_peak + 1e-12), 2),
                    "measuredLufsPostNorm": measure_lufs(norm_path),
                }
            song_rep["segments"].append(seg_rep)
            print(f"  {song} {seg['id']:<12} {seg['type']:<11} {bars:>3} bars  "
                  f"win {seg_rep['barWindowSec']:.2f}s spill {seg_rep['spillSec']:.2f}s")
        report["songs"][song] = song_rep

    os.makedirs(REPORTS, exist_ok=True)
    with open(os.path.join(REPORTS, "render-report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("render-report.json written")


if __name__ == "__main__":
    main()
