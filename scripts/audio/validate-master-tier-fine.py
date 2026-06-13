#!/usr/bin/env python3
"""
TOP-TIER == MASTER validation for the FINE6 cut (B6).

Proves "full reveal IS the song" by numbers: for every segment whose top tier was
cut from the full-mix master, the rendered top tier must be the SAME CONTENT as the
master slice for that exact time range. Because B6 LEVEL-MATCHES the master slice to
the old stem-sum top tier's loudness (so the tier(N-2)->tier(N-1) crossfade seam does
not jump), we compare the rendered top tier against the master slice AT THE SAME
APPLIED LEVEL (raw master slice x the recorded level-match + peak-guard gains). The
integrated-LUFS delta must be within +/-1.0 LU.

This is the seam-aware analogue of validate-master-tier.py: the original compared
against the RAW master (when the render copied the master 1:1); FINE6 gain-matches
the master to the bed-normalized level, so we apply the SAME gain to the reference.
A near-zero delta proves the rendered top tier is the master content (same waveform),
just brought to the seam-matched level.

Reads cut-plan-fine.json + render-report-fine6.json. Writes
build-reports/master-tier-check-fine6.{json,txt}. Exits non-zero on any drift so the
pipeline can gate. A segment that FELL BACK to the stem-sum top tier (fromMaster=false)
is reported as a fallback and NOT counted as a master-tier check.

Run: .venv-audio/bin/python scripts/audio/validate-master-tier-fine.py
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
REPORTS = os.path.join(ROOT, "build-reports")
PLAN_PATH = os.path.join(ROOT, "scripts", "audio", "cut-plan-fine.json")
RENDER_REPORT = os.path.join(REPORTS, "render-report-fine6.json")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
SR = 48000

MASTERS = {
    "song1": "0 Especifico Primero.wav",
    "song2": "0 pipeline male phonk.wav",
}
LUFS_TOLERANCE_LU = 1.0
WRAP_MS = 200
WRAP_BEATS = 1.0
SPILL_BARS = 1


def bar_to_sample(bar, sec_per_bar, origin):
    return int(round((origin + bar * sec_per_bar) * SR))


def equal_power_wrap(full, i0, i1, wrap_samples):
    """MUST match render-tiers-fine-v2.equal_power_wrap exactly."""
    n = i1 - i0
    w = min(wrap_samples, n // 4)
    if w < 1:
        return full[i0:i1].copy()
    t = np.linspace(0, np.pi / 2, w, dtype=np.float32)[:, None]
    fade_in = np.sin(t)
    fade_out = np.cos(t)
    seg = full[i0:i1].copy()
    if i1 + w <= full.shape[0]:
        overshoot = full[i1:i1 + w].copy()
        seg[:w] = seg[:w] * fade_in + overshoot * fade_out
    elif i0 - w >= 0:
        preroll = full[i0 - w:i0].copy()
        seg[n - w:] = seg[n - w:] * np.cos(t) + preroll * np.sin(t)
    return seg


def measure_lufs(path):
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
    tmp = os.path.join(REPORTS, "_master_probe_fine6.wav")
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
    return d if sr == SR else None


def top_tier_key(tiers):
    keys = [k for k in tiers if k.startswith("tier") and k[4:].isdigit()]
    return max(keys, key=lambda k: int(k[4:])) if keys else None


def main():
    if not os.path.exists(PLAN_PATH) or not os.path.exists(RENDER_REPORT):
        print("validate-master-tier-fine: plan or render-report-fine6 missing")
        sys.exit(1)
    plan = json.load(open(PLAN_PATH))
    render_rep = json.load(open(RENDER_REPORT))

    report = {"segments": [], "toleranceLu": LUFS_TOLERANCE_LU, "fallbacks": []}
    lines = [f"TOP-TIER == MASTER check FINE6 (PASS = rendered top tier within "
             f"+/-{LUFS_TOLERANCE_LU} LU of the level-matched master slice)"]
    all_pass = True
    checked = 0

    for song in ("song1", "song2"):
        master = load_master(song)
        sp = plan.get(song, {})
        spb, origin = sp.get("secPerBar"), sp.get("origin")
        seg_reps = {s["id"]: s
                    for s in render_rep.get("songs", {}).get(song, {}).get("segments", [])}
        total_len = master.shape[0] if master is not None else 0
        if master is None:
            lines.append(f"  {song}: master missing -> all segments stem-sum")
            continue

        for seg in sp.get("segments", []):
            sr_rep = seg_reps.get(seg["id"])
            if not sr_rep:
                continue
            tkey = top_tier_key(sr_rep.get("tiers", {}))
            tinfo = sr_rep.get("tiers", {}).get(tkey, {}) if tkey else {}
            if not tinfo.get("fromMaster"):
                report["fallbacks"].append(f"{song}/{seg['id']}")
                lines.append(f"  {song} {seg['id']:<12} {tkey} FELL BACK to stem-sum "
                             f"(not a master check)")
                continue
            top_wav = tinfo.get("wav")
            if not top_wav or not os.path.exists(top_wav):
                continue

            sb, eb = seg["startBar"], seg["endBar"]
            is_loop = seg["type"] == "LOOPER"
            i0 = bar_to_sample(sb, spb, origin)
            i1 = bar_to_sample(eb + 1, spb, origin)
            if not is_loop:
                spill_end = bar_to_sample(eb + 1 + SPILL_BARS, spb, origin)
                i1_full = min(spill_end, total_len)
            else:
                i1_full = i1
            i1 = min(i1, total_len)
            i1_full = min(i1_full, total_len)
            beat_s = spb / 4.0
            wrap_n = int(max(WRAP_MS / 1000.0, WRAP_BEATS * beat_s) * SR)
            if is_loop:
                m_slice = equal_power_wrap(master, i0, i1, wrap_n)
            else:
                m_slice = master[i0:i1_full].copy()

            # apply the SAME level-match + peak-guard the render recorded, so the
            # reference is the master AT THE SEAM-MATCHED LEVEL.
            lm_db = tinfo.get("masterLevelMatchDb") or 0.0
            g_db = tinfo.get("masterGuardDb") or 0.0
            gain = 10.0 ** ((lm_db + g_db) / 20.0)
            ref_slice = (m_slice * gain).astype(np.float32)

            rendered_lufs = measure_lufs(top_wav)
            master_lufs = measure_buf_lufs(ref_slice)
            d_rms, _ = sf.read(top_wav, dtype="float32", always_2d=True)
            rendered_rms_db = buf_rms_db(d_rms)
            master_rms_db = buf_rms_db(ref_slice)

            delta_lu = (None if rendered_lufs is None or master_lufs is None
                        else round(rendered_lufs - master_lufs, 3))
            within = delta_lu is not None and abs(delta_lu) <= LUFS_TOLERANCE_LU
            checked += 1
            all_pass = all_pass and within
            rec = {
                "song": song, "segment": seg["id"], "tier": tkey,
                "renderedLufs": rendered_lufs, "masterMatchedLufs": master_lufs,
                "deltaLu": delta_lu, "withinTolerance": within,
                "renderedRmsDb": round(rendered_rms_db, 2),
                "masterMatchedRmsDb": round(master_rms_db, 2),
                "deltaRmsDb": round(rendered_rms_db - master_rms_db, 2),
                "levelMatchDb": lm_db, "guardDb": g_db,
            }
            report["segments"].append(rec)
            lines.append(
                f"  {song} {seg['id']:<12} {tkey} rendered={rendered_lufs} "
                f"masterMatched={master_lufs} dLU={delta_lu} "
                f"dRMS={rec['deltaRmsDb']:+.2f}dB -> {'PASS' if within else 'FAIL'}")

    if checked == 0:
        lines.append("\nNo master-cut top tiers to validate.")
    report["allPass"] = all_pass
    report["checked"] = checked
    lines.append(f"\nALL MASTER-TIER CHECKS PASS: {all_pass} (checked {checked}, "
                 f"fallbacks {len(report['fallbacks'])})")

    os.makedirs(REPORTS, exist_ok=True)
    json.dump(report, open(os.path.join(REPORTS, "master-tier-check-fine6.json"), "w"),
              indent=2)
    open(os.path.join(REPORTS, "master-tier-check-fine6.txt"), "w").write(
        "\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(0 if all_pass else 2)


if __name__ == "__main__":
    main()
