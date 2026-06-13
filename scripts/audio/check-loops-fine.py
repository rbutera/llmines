#!/usr/bin/env python3
"""
Loop-cleanliness check for the FINE6 LOOPER tier files (B6 included).

Same mechanic as check-loops.py but: reads cut-plan-fine.json, scans
build-fine6/wav, and checks EVERY tier index that exists per segment (tier0..tierN),
so the NEW master-cut top tier (the B6 content) is loop-seam-validated too.

PASS = whole-bar AND the loop join introduces no step that stands out above normal
interior program material (join step within JOIN_VS_INTERIOR_THRESH_DB of the
interior 99th-pct step, OR below the absolute floor).

Reports build-reports/loop-check-fine6.{json,txt}. Exits non-zero on any failure.

Run: .venv-audio/bin/python scripts/audio/check-loops-fine.py
"""
import json
import os
import sys
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
OUT_WAV = os.path.join(ROOT, "build-fine6", "wav")
REPORTS = os.path.join(ROOT, "build-reports")
PLAN = json.load(open(os.path.join(ROOT, "scripts", "audio", "cut-plan-fine.json")))
SEAM_MS = 5.0
JOIN_VS_INTERIOR_THRESH_DB = 6.0
SEAM_STEP_ABS_FLOOR = 0.02


def seam_metrics(path):
    d, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = d.mean(axis=1)
    n = len(mono)
    w = int(SEAM_MS / 1000 * sr)
    looped = np.concatenate([mono, mono[: 2 * w]])
    diff = np.abs(np.diff(looped))
    seam_step = float(abs(mono[0] - mono[-1]))
    join_window = diff[n - w: n + w]
    join_max = float(join_window.max())
    interior = diff[w: n - w]
    interior_p99 = float(np.percentile(interior, 99)) + 1e-12
    join_vs_interior_db = 20 * np.log10(join_max / interior_p99)
    return {
        "samples": n, "duration_s": round(n / sr, 5),
        "seam_step_abs": round(seam_step, 6), "join_max_step": round(join_max, 6),
        "interior_p99_step": round(interior_p99, 6),
        "join_vs_interior_db": round(join_vs_interior_db, 2), "sr": sr,
    }


def seg_tier_keys(song, seg_id):
    segdir = os.path.join(OUT_WAV, song)
    if not os.path.isdir(segdir):
        return []
    found = sorted(f for f in os.listdir(segdir)
                   if f.startswith(f"{seg_id}-tier") and f.endswith(".wav"))
    return [f[len(seg_id) + 1:-len(".wav")] for f in found]


def main():
    report = {"loopers": [], "joinVsInteriorThreshDb": JOIN_VS_INTERIOR_THRESH_DB,
              "seamStepAbsFloor": SEAM_STEP_ABS_FLOOR}
    lines = [f"FINE6 LOOPER seam check (PASS = whole-bar AND join step within "
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
            for tier in seg_tier_keys(song, seg["id"]):
                path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tier}.wav")
                if not os.path.exists(path):
                    continue
                m = seam_metrics(path)
                ratio = m["duration_s"] / spb
                whole_bar = bool(abs(ratio - round(ratio)) < 0.01)
                bars_meas = round(ratio)
                seam_clean = bool(
                    m["join_vs_interior_db"] <= JOIN_VS_INTERIOR_THRESH_DB
                    or m["seam_step_abs"] < SEAM_STEP_ABS_FLOOR)
                passed = bool(whole_bar and seam_clean)
                all_pass = all_pass and passed
                report["loopers"].append({
                    "song": song, "segment": seg["id"], "tier": tier,
                    "bars_expected": bars, "bars_measured": bars_meas,
                    "whole_bar": whole_bar, "seam_clean": seam_clean, "pass": passed,
                    **m})
                lines.append(
                    f"  {song} {seg['id']:<11} {tier} bars {bars_meas}/{bars} "
                    f"wholebar={whole_bar} seamStep={m['seam_step_abs']:.2e} "
                    f"join={m['join_max_step']:.2e} int_p99={m['interior_p99_step']:.2e} "
                    f"j/i={m['join_vs_interior_db']:+.1f}dB -> "
                    f"{'PASS' if passed else 'FAIL'}")
    report["all_pass"] = all_pass
    lines.append(f"\nALL FINE6 LOOPER TIERS PASS: {all_pass}")
    os.makedirs(REPORTS, exist_ok=True)
    json.dump(report, open(os.path.join(REPORTS, "loop-check-fine6.json"), "w"),
              indent=2)
    open(os.path.join(REPORTS, "loop-check-fine6.txt"), "w").write(
        "\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(0 if all_pass else 2)


if __name__ == "__main__":
    main()
