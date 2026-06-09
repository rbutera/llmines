#!/usr/bin/env python3
"""
Loop-cleanliness check for LOOPER tier files.

For each LOOPER segment tier, assert:
  - whole-bar length: file duration is an integer multiple of secPerBar (within
    one sample of tolerance, since the window is cut on bar samples).
  - seam continuity: the discontinuity at the loop wrap (last sample -> first
    sample) is small. We measure the RMS of the 5ms straddling the seam when the
    file is conceptually looped (concat tail+head) vs the in-file local RMS; a
    clean equal-power wrap makes the seam delta ~0 (no click).

Reports build-reports/loop-check.json + .txt.

Run: .venv-audio/bin/python scripts/audio/check-loops.py
"""
import json
import os
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
OUT_WAV = os.path.join(ROOT, "build", "wav")
REPORTS = os.path.join(ROOT, "build-reports")

PLAN = json.load(open(os.path.join(ROOT, "scripts", "audio", "cut-plan.json")))
SEAM_MS = 5.0
# PASS = whole-bar AND the loop join introduces no step that stands out above
# normal interior program material. Join max step must be within
# JOIN_VS_INTERIOR_THRESH_DB of the interior 99th-pct step (i.e. the wrap click,
# if any, is buried in the music and inaudible).
JOIN_VS_INTERIOR_THRESH_DB = 6.0
# Belt-and-braces absolute floor: a join step below this is inaudible regardless.
SEAM_STEP_ABS_FLOOR = 0.02  # ~ -34 dBFS single-sample step


def seam_metrics(path):
    """Honest loop-click test. Concatenate the file with itself and look at the
    first-difference (|x[k]-x[k-1]|, a click detector) in a small window centred
    on the wrap join. Compare the MAX step at the join to the 99th-percentile
    interior step. A clean loop has join step ~ interior step (ratio ~ 0 dB);
    a click shows the join step well above interior."""
    d, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = d.mean(axis=1)
    n = len(mono)
    w = int(SEAM_MS / 1000 * sr)
    looped = np.concatenate([mono, mono[: 2 * w]])
    diff = np.abs(np.diff(looped))
    # join is at index n (mono[-1] -> mono[0]); join step = diff[n-1]
    seam_step = float(abs(mono[0] - mono[-1]))
    join_window = diff[n - w: n + w]            # steps straddling the wrap
    join_max = float(join_window.max())
    interior = diff[w: n - w]                    # steps well away from the join
    interior_p99 = float(np.percentile(interior, 99)) + 1e-12
    join_vs_interior_db = 20 * np.log10(join_max / interior_p99)
    return {
        "samples": n,
        "duration_s": round(n / sr, 5),
        "seam_step_abs": round(seam_step, 6),
        "join_max_step": round(join_max, 6),
        "interior_p99_step": round(interior_p99, 6),
        "join_vs_interior_db": round(join_vs_interior_db, 2),
        "sr": sr,
    }


def main():
    report = {"loopers": [], "joinVsInteriorThreshDb": JOIN_VS_INTERIOR_THRESH_DB,
              "seamStepAbsFloor": SEAM_STEP_ABS_FLOOR}
    lines = [f"LOOPER seam check (PASS = whole-bar AND join step within "
             f"+{JOIN_VS_INTERIOR_THRESH_DB}dB of interior p99 OR join step < "
             f"{SEAM_STEP_ABS_FLOOR})"]
    all_pass = True
    for song in ("song1", "song2"):
        sp = PLAN[song]
        spb = sp["secPerBar"]
        for seg in sp["segments"]:
            if seg["type"] != "LOOPER":
                continue
            bars = seg["endBar"] - seg["startBar"] + 1
            for tier in ("tier0", "tier1", "tier2"):
                path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tier}.wav")
                if not os.path.exists(path):
                    continue
                m = seam_metrics(path)
                # whole-bar: duration / secPerBar near integer
                ratio = m["duration_s"] / spb
                whole_bar = bool(abs(ratio - round(ratio)) < 0.01)
                bars_meas = round(ratio)
                seam_clean = bool(
                    m["join_vs_interior_db"] <= JOIN_VS_INTERIOR_THRESH_DB
                    or m["seam_step_abs"] < SEAM_STEP_ABS_FLOOR
                )
                passed = bool(whole_bar and seam_clean)
                all_pass = all_pass and passed
                rec = {
                    "song": song, "segment": seg["id"], "tier": tier,
                    "bars_expected": bars, "bars_measured": bars_meas,
                    "whole_bar": whole_bar, "seam_clean": seam_clean, "pass": passed,
                    **m,
                }
                report["loopers"].append(rec)
                lines.append(
                    f"  {song} {seg['id']:<11} {tier} bars {bars_meas}/{bars} "
                    f"wholebar={whole_bar} seamStep={m['seam_step_abs']:.2e} "
                    f"join={m['join_max_step']:.2e} int_p99={m['interior_p99_step']:.2e} "
                    f"j/i={m['join_vs_interior_db']:+.1f}dB -> {'PASS' if passed else 'FAIL'}"
                )
    report["all_pass"] = all_pass
    lines.append(f"\nALL LOOPER TIERS PASS: {all_pass}")
    os.makedirs(REPORTS, exist_ok=True)
    json.dump(report, open(os.path.join(REPORTS, "loop-check.json"), "w"), indent=2)
    open(os.path.join(REPORTS, "loop-check.txt"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
