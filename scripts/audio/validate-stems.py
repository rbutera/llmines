#!/usr/bin/env python3
"""
Wave-1 stem validation for the LLMines audio redesign.

For each native Suno-Studio stem, emit a per-stem report:
  - decode check (does the WAV decode end-to-end via soundfile?)
  - duration (target ~197s, uniform across stems)
  - sample rate / channels / subtype
  - noise floor: mean+max dBFS over the QUIETEST 1s window found in the file
    (proxy for "quiet region" volumedetect). Target mean <= -60 dBFS for a
    layer that should be clean; for content-heavy stems (drums/vocals) the
    quietest window is the true silence floor, so it should still be low.
  - peak dBFS and integrated RMS dBFS (overall level, informational)

Writes JSON + a human table to build-reports/.

Run: .venv-audio/bin/python scripts/audio/validate-stems.py
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT = os.path.join(ROOT, "build-reports")

# Locked grids
GRID = {
    "song1": {"bpm": 109.957, "sec_per_bar": 2.1827, "origin": 0.058},
    "song2": {"bpm": 126.05, "sec_per_bar": 1.904, "origin": 0.0},
}

STEMS = {
    "song1": [
        "0 Especifico Primero.wav",  # full mix, reference only
        "1 FX.wav", "2 Synth.wav", "3 Percussion.wav", "4 Guitar.wav",
        "5 Bass.wav", "6 Drums.wav", "7 Vocals.wav",
    ],
    "song2": [
        "0 pipeline male phonk.wav",  # full mix, reference only
        "1 FX.wav", "2 Synth.wav", "3 Bass.wav", "4 Drums.wav",
        "5 Backing_Vocals.wav", "6 Vocals.wav",
    ],
}

NOISE_FLOOR_TARGET_DB = -60.0
DURATION_TARGET = 197.0
DURATION_TOL = 1.5


def dbfs(x):
    if x <= 0:
        return -np.inf
    return 20.0 * np.log10(x)


def analyze(path):
    info = sf.info(path)
    # decode the whole file (catch truncation / corruption)
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    n = data.shape[0]
    dur = n / sr
    # mono mix for level analysis
    mono = data.mean(axis=1)
    abs_mono = np.abs(mono)

    peak = float(abs_mono.max()) if n else 0.0
    rms = float(np.sqrt(np.mean(mono**2))) if n else 0.0

    # quietest 1s window: RMS over non-overlapping 1s frames, take min
    win = sr  # 1 second
    n_frames = n // win
    quiet_rms = None
    quiet_peak = None
    if n_frames >= 1:
        frames = mono[: n_frames * win].reshape(n_frames, win)
        frame_rms = np.sqrt(np.mean(frames**2, axis=1))
        qidx = int(np.argmin(frame_rms))
        quiet_rms = float(frame_rms[qidx])
        quiet_peak = float(np.abs(frames[qidx]).max())

    return {
        "decoded_ok": True,
        "samples": n,
        "sample_rate": sr,
        "channels": data.shape[1],
        "subtype": info.subtype,
        "duration_s": round(dur, 4),
        "peak_dbfs": round(dbfs(peak), 2),
        "rms_dbfs": round(dbfs(rms), 2),
        "quiet_window_rms_dbfs": round(dbfs(quiet_rms), 2) if quiet_rms is not None else None,
        "quiet_window_peak_dbfs": round(dbfs(quiet_peak), 2) if quiet_peak is not None else None,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    flags = []
    for song, stems in STEMS.items():
        report[song] = {"grid": GRID[song], "stems": {}}
        durs = []
        for stem in stems:
            path = os.path.join(SRC, song, stem)
            if not os.path.exists(path):
                report[song]["stems"][stem] = {"decoded_ok": False, "error": "MISSING"}
                flags.append(f"{song}/{stem}: MISSING FILE")
                continue
            try:
                a = analyze(path)
            except Exception as e:  # noqa: BLE001
                report[song]["stems"][stem] = {"decoded_ok": False, "error": str(e)}
                flags.append(f"{song}/{stem}: DECODE FAILED: {e}")
                continue
            report[song]["stems"][stem] = a
            durs.append(a["duration_s"])

            # flags
            is_fullmix = stem.startswith("0 ")
            if abs(a["duration_s"] - DURATION_TARGET) > DURATION_TOL:
                flags.append(
                    f"{song}/{stem}: duration {a['duration_s']}s off target {DURATION_TARGET}s"
                )
            nf = a["quiet_window_rms_dbfs"]
            if nf is not None and nf > NOISE_FLOOR_TARGET_DB and not is_fullmix:
                flags.append(
                    f"{song}/{stem}: noise floor {nf}dB > target {NOISE_FLOOR_TARGET_DB}dB"
                )
        # uniformity
        if durs:
            spread = max(durs) - min(durs)
            report[song]["duration_spread_s"] = round(spread, 4)
            if spread > 0.05:
                flags.append(f"{song}: duration spread {round(spread,4)}s across stems (non-uniform)")

    report["flags"] = flags
    with open(os.path.join(OUT, "stem-validation.json"), "w") as f:
        json.dump(report, f, indent=2)

    # human table
    lines = []
    for song, stems in STEMS.items():
        lines.append(f"\n=== {song}  (spread {report[song].get('duration_spread_s','?')}s) ===")
        lines.append(f"{'stem':<26}{'dur':>9}{'peak':>9}{'rms':>9}{'quietRMS':>10}{'sr/ch':>10}")
        for stem in stems:
            a = report[song]["stems"][stem]
            if not a.get("decoded_ok"):
                lines.append(f"{stem:<26}  {a.get('error','ERR')}")
                continue
            lines.append(
                f"{stem:<26}{a['duration_s']:>9}{a['peak_dbfs']:>9}{a['rms_dbfs']:>9}"
                f"{str(a['quiet_window_rms_dbfs']):>10}{str(a['sample_rate'])+'/'+str(a['channels']):>10}"
            )
    lines.append("\n=== FLAGS ===")
    lines += [f"  - {x}" for x in flags] if flags else ["  (none — all clean)"]
    table = "\n".join(lines)
    with open(os.path.join(OUT, "stem-validation.txt"), "w") as f:
        f.write(table + "\n")
    print(table)


if __name__ == "__main__":
    sys.exit(main())
