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

ADDITIVE TIER RENDER (the no-comb fix). The three tiers of a segment share an
identical bed. If each tier were loudnorm'd independently the shared bed would
sit at a slightly different absolute level per tier, so the engine's tier
crossfade (which assumes the bed holds constant) comb-filters / dips on every
reveal. Instead we normalize the BED ONCE per segment: measure tier0's integrated
loudness, derive a SINGLE LINEAR gain to bring it to ~-14 LUFS, then apply that
SAME linear gain to all three tier sums:

    tier0 = g * L1
    tier1 = g * (L1 + L2)
    tier2 = g * (L1 + L2 + L3)

So the L1 component is bit-identical in level across all three files and a
crossfade truly holds the bed constant. A shared peak-guard (driven by the
loudest tier, tier2) keeps the bed bit-identical even when guarding clips.

TOP-TIER == MASTER (audio-truth B6 / task 7.1). The summed top tier (L1+L2+L3)
can never match the mastered song: the master's glue compression / EQ / limiting
is applied to the SUM, not reproducible by adding raw stems. So when
TOP_TIER_FROM_MASTER is on, the TOP tier of each segment is cut from the full-mix
MASTER (`audio-src/<song>/0 *.wav`) at the SAME bar window as the stems, instead
of summing them. Lower tiers stay cumulative stem sums (the no-hiss bed
invariant). The master slice is LEVEL-MATCHED to the stem-sum top once per segment
(a single linear gain so its bed sits at the same level as tier N-2's bed), so the
crossfade from the stem-sum penultimate tier into the master top stays constant-sum
(no level jump). validate-master-tier.py then asserts the rendered top tier's
loudness is within tolerance of the raw master slice for that range.

Layer 4 (SFX) is rendered by render-sfx.py, not here.

Outputs: build/wav/<song>/<segid>-tier{0,1,2,...}.wav  (intermediate, gitignored)
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

# ── TOP-TIER == MASTER (B6 / task 7.1) ────────────────────────────────────────
# When on, render each segment's TOP tier from the full-mix MASTER (cut at the same
# bar window as the stems) instead of summing stems. Originals are preserved: the
# stem-summed top is still written as `<seg>-tierN-stemsum.wav` alongside the master
# top `<seg>-tierN.wav`, so a revert is a file swap (no re-render). Lower tiers are
# unchanged cumulative stem sums.
TOP_TIER_FROM_MASTER = True
# The full-mix master per song (the mastered bounce these stems came from).
MASTERS = {
    "song1": "0 Especifico Primero.wav",
    "song2": "0 pipeline male phonk.wav",
}
# Max |linear gain| (dB) applied to level-match the master slice to the stem-sum top
# before it replaces it. A match beyond this is suspect (wrong master / misalignment)
# — clamp and flag it in the report rather than silently scaling a wrong file.
MASTER_MATCH_MAX_DB = 6.0


def load_stem(song, name):
    d, sr = sf.read(os.path.join(SRC, song, name), dtype="float32", always_2d=True)
    assert sr == SR, f"{name} sr {sr} != {SR}"
    return d


def load_master(song):
    """Load the full-mix master for a song (the mastered bounce), or None if absent.

    Aligned to the same timeline / sample rate as the stems (they were bounced from
    the same session), so the same bar->sample windowing applies. Returns a 2D
    float32 array (frames, channels) or None when TOP_TIER_FROM_MASTER is off / the
    file is missing — in which case the caller falls back to the stem-sum top.
    """
    if not TOP_TIER_FROM_MASTER:
        return None
    name = MASTERS.get(song)
    if not name:
        return None
    path = os.path.join(SRC, song, name)
    if not os.path.exists(path):
        print(f"  WARN: master {path} missing -> top tier falls back to stem sum")
        return None
    d, sr = sf.read(path, dtype="float32", always_2d=True)
    assert sr == SR, f"master {name} sr {sr} != {SR}"
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


def write_wav(path, buf):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, buf, SR, subtype="FLOAT")


def measure_lufs(path):
    """Integrated loudness (LUFS) of a file via loudnorm print_format=json (analysis)."""
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
    """Measure integrated loudness of an in-memory float buffer (temp WAV round-trip)."""
    tmp = os.path.join(OUT_WAV, "_lufs_probe.wav")
    write_wav(tmp, buf)
    val = measure_lufs(tmp)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return val


def buf_rms(buf):
    """Linear RMS of a float buffer (cheap level proxy for the master level-match)."""
    if buf is None or buf.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(buf, dtype=np.float64))))


def master_match_gain(master_slice, stemsum_top):
    """Linear gain to bring the MASTER slice's level to the stem-sum top's level.

    The crossfade from the penultimate (stem-sum) tier into the master top must be
    constant-sum: the bed level can't jump at the swap. We RMS-match the master slice
    to the stem-sum top (which shares the same bed level as the lower tiers by the
    additive normalize), then clamp the gain to MASTER_MATCH_MAX_DB so a wrong/
    misaligned master can't blow the level. Returns (gain, clamped, deltaDb).
    """
    ref = buf_rms(stemsum_top)
    cur = buf_rms(master_slice)
    if cur <= 1e-9 or ref <= 1e-9:
        return 1.0, False, 0.0
    g = ref / cur
    max_lin = 10.0 ** (MASTER_MATCH_MAX_DB / 20.0)
    clamped = False
    if g > max_lin:
        g, clamped = max_lin, True
    elif g < 1.0 / max_lin:
        g, clamped = 1.0 / max_lin, True
    return float(g), clamped, round(20 * np.log10(g + 1e-12), 3)


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
        # full-mix master for the TOP-tier-from-master swap (B6); None -> stem-sum top.
        master = load_master(song)
        if master is not None:
            # align master length to the stem timeline (truncate / zero-pad to match).
            if master.shape[0] >= total_len:
                master = master[:total_len]
            else:
                pad = np.zeros((total_len - master.shape[0], master.shape[1]), np.float32)
                master = np.concatenate([master, pad], axis=0)

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
            # the TOP tier key (the full mix incl. vocals) — last by index.
            top_tier = sorted(full_by_tier, key=lambda k: int(k[4:]))[-1]
            beat_s = spb / 4.0
            wrap_n = int(max(WRAP_MS / 1000.0, WRAP_BEATS * beat_s) * SR)

            seg_rep = {
                "id": seg["id"], "type": seg["type"], "bars": bars,
                "startSec": round(i0 / SR, 4),
                "barWindowSec": round((i1 - i0) / SR, 4),
                "spillSec": round(spill / SR, 4),
                "tiers": {},
            }

            # 1) Window each tier's raw sum (loop-wrap for LOOPER, play-through else).
            windowed = {}
            for tname, full_buf in full_by_tier.items():
                if is_loop:
                    # whole-bar loop: window [i0,i1], seam crossfaded with pre-roll
                    windowed[tname] = equal_power_wrap(full_buf, i0, i1, wrap_n)
                else:
                    windowed[tname] = full_buf[i0:i1_full].copy()

            # 1b) TOP-TIER == MASTER (B6 / task 7.1). Cut the master at the SAME window
            #     as the stems, level-match it to the stem-sum top so the bed level holds
            #     across the penultimate->top crossfade, and REPLACE the windowed top with
            #     it. The stem-sum top is PRESERVED (written as -stemsum.wav) so a revert
            #     is a file swap. Lower tiers are untouched stem sums.
            master_meta = None
            if master is not None:
                if is_loop:
                    master_win = equal_power_wrap(master, i0, i1, wrap_n)
                else:
                    master_win = master[i0:i1_full].copy()
                stemsum_top = windowed[top_tier]  # keep the original sum to preserve
                g, clamped, delta_db = master_match_gain(master_win, stemsum_top)
                master_top = master_win * g
                # preserve the original stem-sum top alongside (revert = swap).
                windowed[f"{top_tier}-stemsum"] = stemsum_top
                windowed[top_tier] = master_top
                master_meta = {
                    "source": MASTERS.get(song),
                    "matchGainDb": delta_db,
                    "matchClamped": clamped,
                }

            # 2) ADDITIVE normalize: derive ONE linear gain from the bed (tier0) so
            #    the L1 component is bit-identical in level across all three tiers.
            bed = windowed["tier0"]
            bed_lufs = measure_buf_lufs(bed)
            # If the bed is effectively silent (e.g. s1-intro tier0), loudnorm gain
            # is meaningless -> derive the gain from the loudest tier instead so the
            # arrangement still lands near target (bed identity is moot when silent).
            # the stem-SUM top (the additive-normalize reference). When the top was
            # swapped for the master slice, the preserved `-stemsum` copy is the true
            # reference (the master slice is already level-matched to it, so deriving the
            # additive gain from it keeps the bed identity across all the stem tiers).
            stemsum_top_buf = windowed.get(f"{top_tier}-stemsum", windowed[top_tier])
            ref_lufs = bed_lufs
            ref_name = "tier0"
            if bed_lufs is None or bed_lufs <= -60.0 or bed_lufs == float("-inf"):
                ref_lufs = measure_buf_lufs(stemsum_top_buf)
                ref_name = f"{top_tier}-stemsum"
            lin_gain = 1.0
            if ref_lufs is not None and ref_lufs > -float("inf"):
                lin_gain = float(10.0 ** ((TARGET_LUFS - ref_lufs) / 20.0))

            # 3) Shared peak-guard: scale ALL tiers by ONE factor driven by the
            #    loudest (the stem-sum top) so the bed stays bit-identical even if we clip.
            loud_peak = float(np.abs(stemsum_top_buf * lin_gain).max())
            guard = 1.0
            if loud_peak > 0.97:
                guard = 0.97 / loud_peak
            applied = lin_gain * guard

            # Write every windowed tier (incl. the preserved `<top>-stemsum` revert copy).
            # The master top is NOT scaled by the additive `applied` gain (it is already
            # level-matched to the stem-sum top, which the additive gain targets); a
            # second multiply would double-apply. Only the constant-sum stem tiers + the
            # preserved stem-sum copy take `applied`.
            for tname in sorted(windowed, key=lambda k: (k.replace("-stemsum", ""), "-stemsum" in k)):
                is_master_top = master_meta is not None and tname == top_tier
                buf = windowed[tname] if is_master_top else windowed[tname] * applied
                # the master top still needs the shared peak-guard so it can't clip past
                # the bed it was matched to.
                if is_master_top:
                    buf = buf * guard
                norm_path = os.path.join(OUT_WAV, song, f"{seg['id']}-{tname}.wav")
                # 24-bit WAV (matches the prior pipeline's pcm_s24le output).
                os.makedirs(os.path.dirname(norm_path), exist_ok=True)
                sf.write(norm_path, buf, SR, subtype="PCM_24")
                seg_rep["tiers"][tname] = {
                    "wav": norm_path,
                    "peakDb": round(20 * np.log10(float(np.abs(buf).max()) + 1e-12), 2),
                    "measuredLufs": measure_lufs(norm_path),
                    "fromMaster": is_master_top,
                }
            seg_rep["additive"] = {
                "refTier": ref_name,
                "refLufs": ref_lufs,
                "linGainDb": round(20 * np.log10(lin_gain + 1e-12), 3),
                "peakGuardDb": round(20 * np.log10(guard + 1e-12), 3),
            }
            if master_meta is not None:
                seg_rep["topTierFromMaster"] = master_meta
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
