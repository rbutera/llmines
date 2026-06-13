#!/usr/bin/env python3
"""
FINE6 cut + tier-render — FINE5 mechanics PLUS B6 (top tier = master slice).

Identical to render-tiers-fine.py (additive single-gain bed normalization, the
no-hiss/no-comb mechanic: every tier of a segment shares a bit-identical bed so a
crossfade holds the bed constant) for every tier EXCEPT the TOP tier.

B6 (top tier = the master mix): for each segment the TOP tier (last layer in
LAYER_STACK — song1 tier3 +Vocals, song2 tier4 +Vocals) is cut from the FULL-MIX
MASTER (`audio-src/<song>/0 *.wav`) at the SAME sample boundaries used for the stem
cut, INSTEAD of summing stems. "Full reveal IS the song."

CRITICAL SEAM HANDLING. The tier(N-2)->tier(N-1) crossfade must not jump, so the
master-slice top tier is LEVEL-MATCHED to the integrated loudness of the OLD
stem-sum top tier it replaces:
  1. Window + normalize ALL tiers exactly as FINE5 (the additive single-gain bed
     path), giving the stem-sum top tier `oldTop` at its final post-gain level.
  2. Measure oldTop's integrated LUFS.
  3. Window the MASTER over the same samples (same loop-wrap / play-through tail).
  4. Measure the master slice's LUFS, derive a SINGLE linear delta gain
     (10^((oldTopLufs - masterLufs)/20)) and apply it so the rendered master top
     tier integrates to oldTop's loudness — the crossfade into it holds level.
  5. A peak guard on the level-matched master keeps it < 0.99 (the master is already
     a finished mix near full-scale; matching it to the bed's ~-14 LUFS bed-level can
     push peaks up — guard, and report the guard so the validator accounts for it).
Lower tiers (tier0..N-2) are byte-identical to FINE5 (do not touch).

If the master is missing or its slice is silent, the top tier FALLS BACK to the
FINE5 stem-sum top tier (recorded fromMaster=false) so the cut is always complete.

Outputs: build-fine6/wav/<song>/<segid>-tier{0..N}.wav
         build-reports/render-report-fine6.json  (per top tier: fromMaster,
           masterLevelMatchDb, oldTopLufs, masterSliceLufs, renderedTopLufs)

Run: .venv-audio/bin/python scripts/audio/render-tiers-fine-v2.py
"""
import json
import os
import subprocess
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT_WAV = os.path.join(ROOT, "build-fine6", "wav")
REPORTS = os.path.join(ROOT, "build-reports")
PLAN_PATH = os.path.join(ROOT, "scripts", "audio", "cut-plan-fine.json")
REPORT_PATH = os.path.join(REPORTS, "render-report-fine6.json")
FFMPEG = "/opt/homebrew/bin/ffmpeg"

SR = 48000
WRAP_MS = 200          # floor
WRAP_BEATS = 1.0       # target wrap length in beats (beat = secPerBar / 4)
TARGET_LUFS = -14.0

# ── FINE LAYER STACK (one-line-edit config) — identical to FINE5 ─────────────
LAYER_STACK = {
    "song1": [
        ("drums",  ["6 Drums.wav", "3 Percussion.wav"]),
        ("bass",   ["5 Bass.wav"]),
        ("instr",  ["2 Synth.wav", "4 Guitar.wav", "1 FX.wav"]),
        ("vocals", ["7 Vocals.wav"]),
    ],
    "song2": [
        ("drums",   ["4 Drums.wav"]),
        ("bass",    ["3 Bass.wav"]),
        ("instr",   ["2 Synth.wav", "1 FX.wav"]),
        ("backvox", ["5 Backing_Vocals.wav"]),
        ("vocals",  ["6 Vocals.wav"]),
    ],
}

# the full-mix master per song (B6 top-tier source).
MASTERS = {
    "song1": "0 Especifico Primero.wav",
    "song2": "0 pipeline male phonk.wav",
}

# spill tail for play-through segments (bars of decay past the boundary)
SPILL_BARS = 1


def load_wav(song, name):
    d, sr = sf.read(os.path.join(SRC, song, name), dtype="float32", always_2d=True)
    assert sr == SR, f"{name} sr {sr} != {SR}"
    return d


def sum_stems(stems, names):
    acc = None
    for n in names:
        d = stems[n]
        acc = d.copy() if acc is None else acc + d
    return acc


def bar_to_sample(bar, sec_per_bar, origin):
    return int(round((origin + bar * sec_per_bar) * SR))


def equal_power_wrap(full, i0, i1, wrap_samples):
    """Seamless bar-loop of full[i0:i1] via equal-power overlap-add at the wrap.
    Identical to render-tiers-fine.py."""
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


def write_wav(path, buf):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, buf, SR, subtype="FLOAT")


def measure_lufs(path):
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


def measure_buf_lufs(buf):
    tmp = os.path.join(OUT_WAV, "_lufs_probe.wav")
    write_wav(tmp, buf)
    val = measure_lufs(tmp)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return val


def cumulative_tiers(song, stems):
    """Return ordered list of (tierName, cumulative_buffer) per the LAYER_STACK."""
    layers = LAYER_STACK[song]
    tiers = []
    acc = None
    for idx, (_lname, names) in enumerate(layers):
        layer_buf = sum_stems(stems, names)
        acc = layer_buf if acc is None else acc + layer_buf
        tiers.append((f"tier{idx}", acc.copy()))
    return tiers


def main():
    with open(PLAN_PATH) as f:
        plan = json.load(f)

    report = {"songs": {}}
    for song in ("song1", "song2"):
        sp = plan[song]
        spb, origin = sp["secPerBar"], sp["origin"]
        # load all needed stems once
        needed = set()
        for _ln, names in LAYER_STACK[song]:
            needed.update(names)
        stems = {n: load_wav(song, n) for n in needed}
        full_by_tier = dict(cumulative_tiers(song, stems))
        tier_names = list(full_by_tier.keys())  # tier0..tierN in cumulative order
        top_tier = tier_names[-1]
        total_len = full_by_tier[tier_names[0]].shape[0]

        # B6: load the full-mix master for this song (None -> fall back to stem-sum).
        master = None
        master_name = MASTERS.get(song)
        if master_name and os.path.exists(os.path.join(SRC, song, master_name)):
            master = load_wav(song, master_name)

        song_rep = {"segments": [], "tierNames": tier_names,
                    "layerStack": [(ln, names) for ln, names in LAYER_STACK[song]],
                    "topTier": top_tier,
                    "master": master_name if master is not None else None}
        for seg in sp["segments"]:
            sb, eb = seg["startBar"], seg["endBar"]
            bars = eb - sb + 1
            i0 = bar_to_sample(sb, spb, origin)
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

            beat_s = spb / 4.0
            wrap_n = int(max(WRAP_MS / 1000.0, WRAP_BEATS * beat_s) * SR)

            seg_rep = {
                "id": seg["id"], "type": seg["type"], "bars": bars,
                "startSec": round(i0 / SR, 4),
                "barWindowSec": round((i1 - i0) / SR, 4),
                "spillSec": round(spill / SR, 4),
                "tiers": {},
            }

            # 1) Window each cumulative tier (loop-wrap for LOOPER, play-through else).
            windowed = {}
            for tname, full_buf in full_by_tier.items():
                if is_loop:
                    windowed[tname] = equal_power_wrap(full_buf, i0, i1, wrap_n)
                else:
                    windowed[tname] = full_buf[i0:i1_full].copy()

            # 2) ADDITIVE normalize (UNCHANGED FINE5): ONE linear gain from the bed.
            bed = windowed["tier0"]
            bed_lufs = measure_buf_lufs(bed)
            ref_lufs = bed_lufs
            ref_name = "tier0"
            if bed_lufs is None or bed_lufs <= -60.0 or bed_lufs == float("-inf"):
                ref_lufs = measure_buf_lufs(windowed[top_tier])
                ref_name = top_tier
            lin_gain = 1.0
            if ref_lufs is not None and ref_lufs > -float("inf"):
                lin_gain = float(10.0 ** ((TARGET_LUFS - ref_lufs) / 20.0))

            # 3) Shared peak-guard: ONE factor driven by the loudest (= stem-sum top).
            loud_peak = float(np.abs(windowed[top_tier] * lin_gain).max())
            guard = 1.0
            if loud_peak > 0.97:
                guard = 0.97 / loud_peak
            applied = lin_gain * guard

            # 4) Materialize the OLD stem-sum top tier buffer (the seam reference even
            #    when we replace it with the master) so we can level-match the master.
            old_top_buf = windowed[top_tier] * applied
            old_top_lufs = measure_buf_lufs(old_top_buf)

            # 5) B6: build the master-slice TOP tier, level-matched to old_top_lufs.
            top_from_master = False
            master_level_match_db = None
            master_slice_lufs = None
            master_guard_db = None
            top_buf = old_top_buf  # default = FINE5 stem-sum (fallback)
            if master is not None:
                if is_loop:
                    m_slice = equal_power_wrap(master, i0, i1, wrap_n)
                else:
                    m_slice = master[i0:i1_full].copy()
                m_lufs = measure_buf_lufs(m_slice)
                master_slice_lufs = m_lufs
                m_peak = float(np.abs(m_slice).max())
                silent = (m_lufs is None or m_lufs <= -60.0
                          or m_lufs == float("-inf") or m_peak < 1e-4)
                if not silent and old_top_lufs is not None \
                        and old_top_lufs > -float("inf"):
                    lm_gain = float(10.0 ** ((old_top_lufs - m_lufs) / 20.0))
                    matched = m_slice * lm_gain
                    # peak guard on the level-matched master (keep < 0.99).
                    mp = float(np.abs(matched).max())
                    mguard = 1.0
                    if mp > 0.99:
                        mguard = 0.99 / mp
                    matched = matched * mguard
                    top_buf = matched.astype(np.float32)
                    top_from_master = True
                    master_level_match_db = round(20 * np.log10(lm_gain + 1e-12), 3)
                    master_guard_db = round(20 * np.log10(mguard + 1e-12), 3)

            # 6) Emit every tier. Lower tiers = FINE5 stem-sum; top = master (or fallback).
            for tname in tier_names:
                if tname == top_tier:
                    buf = top_buf
                else:
                    buf = windowed[tname] * applied
                norm_path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tname}.wav")
                os.makedirs(os.path.dirname(norm_path), exist_ok=True)
                sf.write(norm_path, buf, SR, subtype="PCM_24")
                tinfo = {
                    "wav": norm_path,
                    "peakDb": round(20 * np.log10(float(np.abs(buf).max()) + 1e-12), 2),
                    "measuredLufs": measure_lufs(norm_path),
                }
                if tname == top_tier:
                    tinfo["fromMaster"] = top_from_master
                    tinfo["oldTopLufs"] = old_top_lufs
                    tinfo["masterSliceLufs"] = master_slice_lufs
                    tinfo["masterLevelMatchDb"] = master_level_match_db
                    tinfo["masterGuardDb"] = master_guard_db
                seg_rep["tiers"][tname] = tinfo
            seg_rep["additive"] = {
                "refTier": ref_name,
                "refLufs": ref_lufs,
                "linGainDb": round(20 * np.log10(lin_gain + 1e-12), 3),
                "peakGuardDb": round(20 * np.log10(guard + 1e-12), 3),
            }
            song_rep["segments"].append(seg_rep)
            fm = "MASTER" if top_from_master else "stemsum(fallback)"
            print(f"  {song} {seg['id']:<13} {seg['type']:<11} {bars:>3} bars  "
                  f"win {seg_rep['barWindowSec']:.2f}s spill {seg_rep['spillSec']:.2f}s  "
                  f"tiers={len(tier_names)} top={fm}")
        report["songs"][song] = song_rep

    os.makedirs(REPORTS, exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    print(f"{os.path.basename(REPORT_PATH)} written")


if __name__ == "__main__":
    main()
