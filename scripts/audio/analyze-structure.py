#!/usr/bin/env python3
"""
Derive section boundaries from the stems, snapped to the locked bar grid.

song1's structure map (Rai) has NO timestamps, only an ordered section list with
bar counts for the instrumentals. song2 has rough timestamps. For both, we use
the VOCAL stem energy envelope to find where vocals enter/leave, which is the
ground truth for PROGRESSION(vocal) vs LOOPER(instrumental) boundaries, then snap
every boundary to the nearest bar via the locked grid.

Output: build-reports/structure-<song>.txt  — a per-bar vocal-activity map and a
proposed bar-snapped boundary list, for the human (Rai) to sanity-check and for
the render script to consume via cut-plan.py.

Run: .venv-audio/bin/python scripts/audio/analyze-structure.py
"""
import os
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT = os.path.join(ROOT, "build-reports")

GRID = {
    "song1": {"bpm": 109.957, "sec_per_bar": 2.1827, "origin": 0.058,
              "vocal": "7 Vocals.wav", "dur": 197.404},
    "song2": {"bpm": 126.05, "sec_per_bar": 1.904, "origin": 0.0,
              "vocal": "6 Vocals.wav", "dur": 196.801},
}

VOCAL_ACTIVE_DB = -45.0  # per-bar vocal RMS above this = "vocals present"


def bar_rms_db(mono, sr, origin, sec_per_bar, n_bars):
    out = []
    for b in range(n_bars):
        t0 = origin + b * sec_per_bar
        t1 = t0 + sec_per_bar
        i0, i1 = int(t0 * sr), int(t1 * sr)
        i1 = min(i1, len(mono))
        if i1 <= i0:
            out.append(-120.0)
            continue
        seg = mono[i0:i1]
        rms = float(np.sqrt(np.mean(seg**2)))
        out.append(20.0 * np.log10(rms + 1e-12))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for song, g in GRID.items():
        vpath = os.path.join(SRC, song, g["vocal"])
        d, sr = sf.read(vpath, dtype="float32", always_2d=True)
        mono = d.mean(axis=1)
        usable = g["dur"] - g["origin"]
        n_bars = int(usable // g["sec_per_bar"])
        bars_db = bar_rms_db(mono, sr, g["origin"], g["sec_per_bar"], n_bars)
        active = [db > VOCAL_ACTIVE_DB for db in bars_db]

        # collapse to runs of vocal-present / vocal-absent
        runs = []
        cur = active[0]
        start = 0
        for i in range(1, n_bars):
            if active[i] != cur:
                runs.append((start, i - 1, cur))
                start = i
                cur = active[i]
        runs.append((start, n_bars - 1, cur))

        lines = [f"=== {song}  bpm={g['bpm']} sec/bar={g['sec_per_bar']} origin={g['origin']} "
                 f"n_bars={n_bars} (dur {g['dur']}s) ===",
                 f"vocal-active threshold: {VOCAL_ACTIVE_DB} dB",
                 "",
                 "per-bar vocal RMS (dB), V=vocal-present:"]
        row = []
        for b in range(n_bars):
            mark = "V" if active[b] else "."
            row.append(f"{b:>3}:{bars_db[b]:6.1f}{mark}")
            if len(row) == 6:
                lines.append("  ".join(row))
                row = []
        if row:
            lines.append("  ".join(row))

        lines.append("")
        lines.append("vocal-presence runs (bar_start..bar_end  state  startSec..endSec):")
        for (s, e, st) in runs:
            t0 = g["origin"] + s * g["sec_per_bar"]
            t1 = g["origin"] + (e + 1) * g["sec_per_bar"]
            lines.append(f"  bars {s:>3}..{e:>3}  {'VOCAL ' if st else 'INSTR '}"
                         f"  {t0:7.2f}s..{t1:7.2f}s  ({e-s+1} bars)")

        txt = "\n".join(lines)
        with open(os.path.join(OUT, f"structure-{song}.txt"), "w") as f:
            f.write(txt + "\n")
        print(txt)
        print()


if __name__ == "__main__":
    main()
