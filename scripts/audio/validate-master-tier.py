#!/usr/bin/env python3
"""
TOP-TIER == MASTER validation (audio-truth task 7.2 / tier-mix-fidelity spec).

The B6 fix renders each segment's TOP tier from the full-mix MASTER (render-tiers.py
TOP_TIER_FROM_MASTER) instead of summing stems, so "full reveal IS the song." This
validator PROVES that by ear-gate-by-numbers rather than by eyeball: for every
segment whose top tier was cut from the master, it compares the rendered top tier's
integrated loudness (LUFS) against the RAW master slice for that exact time range and
asserts the delta is within tolerance (default ±1.0 LU). It fails the pipeline if a
segment's top tier drifts from its master slice — catching a misaligned window, a
wrong master file, or a level-match that over-clamped.

It also reports the RMS delta as a cheap cross-check (the level-match in render-tiers
is RMS-based, so the RMS delta should be near 0; the LUFS delta is the perceptual
gate). Mirrors check-loops.py: reads cut-plan.json + the render report, writes
build-reports/master-tier-check.{json,txt}, prints a per-segment table, exits non-zero
on any failure so CI / the pipeline can gate on it.

Run: .venv-audio/bin/python scripts/audio/validate-master-tier.py
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT_WAV = os.path.join(ROOT, "build", "wav")
REPORTS = os.path.join(ROOT, "build-reports")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
SR = 48000

# the masters, mirrored from render-tiers.py (kept in sync deliberately — a single
# source would couple the scripts; they are small and rarely change).
MASTERS = {
    "song1": "0 Especifico Primero.wav",
    "song2": "0 pipeline male phonk.wav",
}
# integrated-loudness tolerance: the rendered top tier must be within this many LU of
# the raw master slice for its time range. ≈±1.0 LU is below the audible step.
LUFS_TOLERANCE_LU = 1.0


def bar_to_sample(bar, sec_per_bar, origin):
    return int(round((origin + bar * sec_per_bar) * SR))


def measure_lufs(path):
    """Integrated loudness (LUFS) via loudnorm print_format=json (analysis pass)."""
    cmd = [FFMPEG, "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    try:
        err = p.stderr
        start = err.rindex("{")
        end = err.rindex("}") + 1
        return float(json.loads(err[start:end]).get("input_i", 0.0))
    except Exception:  # noqa: BLE001
        return None


def measure_buf_lufs(buf):
    tmp = os.path.join(OUT_WAV, "_master_probe.wav")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    sf.write(tmp, buf, SR, subtype="FLOAT")
    val = measure_lufs(tmp)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return val


def buf_rms_db(buf):
    if buf is None or buf.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(buf, dtype=np.float64))))
    return 20.0 * np.log10(rms + 1e-12)


def load_master(song):
    name = MASTERS.get(song)
    if not name:
        return None
    path = os.path.join(SRC, song, name)
    if not os.path.exists(path):
        return None
    d, sr = sf.read(path, dtype="float32", always_2d=True)
    if sr != SR:
        return None
    return d


def top_tier_key(tiers):
    """The highest `tierN` key present in a render-report segment's tiers map."""
    keys = [k for k in tiers if k.startswith("tier") and k[4:].isdigit()]
    return max(keys, key=lambda k: int(k[4:])) if keys else None


def main():
    plan_path = os.path.join(ROOT, "scripts", "audio", "cut-plan.json")
    rep_path = os.path.join(REPORTS, "render-report.json")
    if not os.path.exists(plan_path) or not os.path.exists(rep_path):
        print("validate-master-tier: cut-plan.json or render-report.json missing "
              "(run render-tiers.py first)")
        sys.exit(1)
    plan = json.load(open(plan_path))
    render_rep = json.load(open(rep_path))

    report = {"segments": [], "toleranceLu": LUFS_TOLERANCE_LU}
    lines = [f"TOP-TIER == MASTER check (PASS = rendered top tier within "
             f"+/-{LUFS_TOLERANCE_LU} LU of the master slice)"]
    all_pass = True
    checked = 0

    for song in ("song1", "song2"):
        master = load_master(song)
        sp = plan.get(song, {})
        spb, origin = sp.get("secPerBar"), sp.get("origin")
        seg_reps = {s["id"]: s for s in render_rep.get("songs", {}).get(song, {}).get("segments", [])}
        if master is None:
            lines.append(f"  {song}: master missing -> skipped (top tier was stem-sum)")
            continue

        for seg in sp.get("segments", []):
            sr_rep = seg_reps.get(seg["id"])
            if not sr_rep:
                continue
            tkey = top_tier_key(sr_rep.get("tiers", {}))
            tinfo = sr_rep.get("tiers", {}).get(tkey, {}) if tkey else {}
            # only validate segments whose top tier was actually cut from the master.
            if not tinfo.get("fromMaster"):
                continue
            top_wav = tinfo.get("wav")
            if not top_wav or not os.path.exists(top_wav):
                continue

            # the raw master slice for this segment's bar window (same windowing as the
            # render; we use the spill-free bar window for the comparison, which is what
            # loops, and the leading play-through window for non-loopers).
            sb, eb = seg["startBar"], seg["endBar"]
            i0 = bar_to_sample(sb, spb, origin)
            i1 = bar_to_sample(eb + 1, spb, origin)
            i0 = max(0, min(i0, master.shape[0]))
            i1 = max(i0, min(i1, master.shape[0]))
            master_slice = master[i0:i1]

            rendered_lufs = measure_lufs(top_wav)
            master_lufs = measure_buf_lufs(master_slice)
            d_rms, _ = sf.read(top_wav, dtype="float32", always_2d=True)
            rendered_rms_db = buf_rms_db(d_rms)
            master_rms_db = buf_rms_db(master_slice)

            delta_lu = (
                None
                if rendered_lufs is None or master_lufs is None
                else round(rendered_lufs - master_lufs, 3)
            )
            within = delta_lu is not None and abs(delta_lu) <= LUFS_TOLERANCE_LU
            checked += 1
            all_pass = all_pass and within
            rec = {
                "song": song, "segment": seg["id"], "tier": tkey,
                "renderedLufs": rendered_lufs, "masterLufs": master_lufs,
                "deltaLu": delta_lu, "withinTolerance": within,
                "renderedRmsDb": round(rendered_rms_db, 2),
                "masterRmsDb": round(master_rms_db, 2),
                "deltaRmsDb": round(rendered_rms_db - master_rms_db, 2),
            }
            report["segments"].append(rec)
            lines.append(
                f"  {song} {seg['id']:<12} {tkey} rendered={rendered_lufs} "
                f"master={master_lufs} dLU={delta_lu} dRMS={rec['deltaRmsDb']:+.2f}dB "
                f"-> {'PASS' if within else 'FAIL'}"
            )

    if checked == 0:
        lines.append("\nNo master-cut top tiers found to validate (TOP_TIER_FROM_MASTER "
                     "off or no fromMaster tiers in the render report).")
    report["allPass"] = all_pass
    report["checked"] = checked
    lines.append(f"\nALL MASTER-TIER CHECKS PASS: {all_pass} (checked {checked})")

    os.makedirs(REPORTS, exist_ok=True)
    json.dump(report, open(os.path.join(REPORTS, "master-tier-check.json"), "w"), indent=2)
    open(os.path.join(REPORTS, "master-tier-check.txt"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    # fail the pipeline on any drift (checked > 0 and not all_pass).
    sys.exit(0 if all_pass else 2)


if __name__ == "__main__":
    main()
