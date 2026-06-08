#!/usr/bin/env python3
"""
v2.6 segment cutter — bar-aligned, whole-song tiling (supersedes cut-song2-segments.py).

The v2.5 cut took SIX fixed 8-bar windows from one hand-picked anchor, which neither
tiled the whole song nor reliably started on a downbeat (song 1's grid is loose).
v2.6 instead:
  1. detects tempo + the bar grid from the DRUMS stem (librosa beat_track),
  2. finds the TRUE music start/end (energy-thresholded, snapped to the beat grid) —
     so a quiet intro isn't missed,
  3. TILES [music_start, music_end] into equal whole-bar segments (8 bars where the
     music allows; a <4-bar tail is MERGED into the previous segment so every segment
     is a clean loop and completion never feels early),
  4. cuts each segment into a `bed` (instrumental stem-sum, vox excluded) loop and a
     `vox` (lead vocals, + backing vox for song 1) loop, equal-power crossfade-wrapped
     on a whole-bar boundary, level-matched, 44.1k stereo 160k MP3,
  5. emits a manifest.json the ENGINE reads for the bank size + per-segment metadata,
  6. FAILS if any segment is not a whole number of bars or a bed/vox pair length-mismatch.

Reproducible: paths are absolute to the stems + this repo's public/audio. Needs
librosa + ffmpeg (venv ~/dev/sdd-eval/.audio-venv).

Usage:  python3 scripts/cut-v26-segments.py [song1|song2|all]
"""

import json
import os
import subprocess
import sys
import tempfile

import librosa
import numpy as np
import soundfile as sf

SR = 44100
XF = 0.20            # 200ms equal-power tail->head wrap
TARGET_PEAK = 0.89   # bed normalised peak
VOX_PEAK = 0.85
SEG_BARS = 8         # nominal segment length in bars
MIN_TAIL_BARS = 4    # tails shorter than this are merged into the previous segment

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEMS_ROOT = os.path.expanduser("~/dev/sdd-eval/sem-final-stems")

# Per-song config: stem dir, instrumental stems (bed), vocal stems (vox), bpm hint, out dir.
SONGS = {
    "song1": {
        "name": "Especifico Primero",
        "src": os.path.join(STEMS_ROOT, "v2"),
        "out": os.path.join(REPO, "public", "audio"),
        "bed": ["2 Drums.mp3", "3 Bass.mp3", "5 Percussion.mp3", "6 Synth.mp3",
                "7 Other.mp3", "4 Guitar.mp3"],
        "vox": ["0 Lead Vocals.mp3", "1 Backing Vocals.mp3"],
        "drums": "2 Drums.mp3",
        "bpm": 110.0,
    },
    "song2": {
        "name": "Verde el Pipeline",
        "src": os.path.join(STEMS_ROOT, "song2", "v2"),
        "out": os.path.join(REPO, "public", "audio", "song2"),
        # Percussion (3) is silent in song2/v2 -> omitted from the bed.
        "bed": ["1 Drums.mp3", "2 Bass.mp3", "4 Synth.mp3", "5 Other.mp3"],
        "vox": ["0 Lead Vocals.mp3"],
        "drums": "1 Drums.mp3",
        "bpm": 126.0,
    },
}


def load_stereo(path):
    y, _ = librosa.load(path, sr=SR, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y  # (2, N)


def load_mono(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y


def loop_crossfade(core, w, micro=256):
    """
    Make `core` loop click-free. Two stages:
      1. Equal-power TAIL->HEAD wrap: the last w samples fade from the tail into
         the head, so the audio approaching the loop point already resembles the
         start (musical continuity across the wrap).
      2. A short MICRO endpoint fade (default ~6ms) ramps the very last samples to
         exactly the first sample, guaranteeing out[-1] == out[0] regardless of
         content — bar-aligned loops land on a downbeat transient, where stage 1
         alone can still leave a small sample jump (a click). Stage 2 forces a
         zero-discontinuity loop point.
    """
    out = core.copy()
    t = np.linspace(0, np.pi / 2, w)
    fade_out, fade_in = np.cos(t), np.sin(t)
    out[:, -w:] = core[:, -w:] * fade_out + core[:, :w] * fade_in
    # micro endpoint fade -> guarantee out[-1] == out[0]
    m = min(micro, out.shape[1] // 4)
    if m > 1:
        ramp = np.linspace(0.0, 1.0, m)
        for ch in range(out.shape[0]):
            out[ch, -m:] = out[ch, -m:] * (1.0 - ramp) + out[ch, 0] * ramp
    return out


def norm(seg, peak):
    p = np.max(np.abs(seg))
    return seg / p * peak if p > 1e-9 else seg


def rms(seg):
    return float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0


def detect_grid(cfg):
    """tempo, beat seconds, bar seconds, first detected beat (s)."""
    drums = load_mono(os.path.join(cfg["src"], cfg["drums"]))
    tempo, beats = librosa.beat.beat_track(
        y=drums, sr=SR, units="time", start_bpm=cfg["bpm"], tightness=200)
    tempo = float(np.atleast_1d(tempo)[0])
    beat = 60.0 / tempo
    return tempo, beat, beat * 4, (beats[0] if len(beats) else 0.0)


def music_bounds(full_mono, bar, beat, beat0):
    """True music [start, end] in seconds, snapped to the beat grid."""
    n = len(full_mono)
    barwin = int(bar * SR)
    gpk = max((rms(full_mono[i:i + barwin]) for i in range(0, max(1, n - barwin), barwin)), default=1.0) or 1.0
    # start: earliest bar-window above 6% of peak
    start = 0.0
    for i in range(0, n, int(0.05 * SR)):
        if rms(full_mono[i:i + barwin]) > 0.06 * gpk:
            start = i / SR
            break
    # snap start to the beat grid
    k = round((start - beat0) / beat)
    start = max(0.0, beat0 + k * beat)
    # end: last bar-window above 6% of peak
    end = n / SR
    for i in range(n - barwin, 0, -int(0.1 * SR)):
        if rms(full_mono[i:i + barwin]) > 0.06 * gpk:
            end = (i + barwin) / SR
            break
    return start, end


def tile(start, end, bar):
    """List of (start_s, end_s, bars) whole-bar segments; short tail merged into prev."""
    seg_len = SEG_BARS * bar
    total = end - start
    nfull = max(1, int(np.floor(total / seg_len)))
    rem_bars = int(round((total - nfull * seg_len) / bar))
    segs = []
    for i in range(nfull):
        s = start + i * seg_len
        segs.append([s, s + seg_len, SEG_BARS])
    if rem_bars >= MIN_TAIL_BARS:
        s = start + nfull * seg_len
        segs.append([s, s + rem_bars * bar, rem_bars])
    elif rem_bars > 0 and segs:
        # merge the short tail into the last full segment
        segs[-1][1] = start + nfull * seg_len + rem_bars * bar
        segs[-1][2] = SEG_BARS + rem_bars
    return [(round(s, 4), round(e, 4), b) for s, e, b in segs]


def character(bed_rms, vox_rms, has_vox, prev_vox):
    """A descriptive label from energy (analysis-driven, not the fixed 13-list)."""
    if not prev_vox and not has_vox:
        return "intro"
    if has_vox:
        return "chorus" if bed_rms > 0.6 else "verse"
    return "break/outro"


def cut_song(key):
    cfg = SONGS[key]
    os.makedirs(cfg["out"], exist_ok=True)
    print(f"\n===== {key}: {cfg['name']} =====")
    print(f"src={cfg['src']}  out={cfg['out']}")

    tempo, beat, bar, beat0 = detect_grid(cfg)
    print(f"tempo={tempo:.3f}  beat={beat * 1000:.1f}ms  bar={bar:.4f}s  beat0={beat0:.3f}s")

    # Load bed + vox stems (stereo for cutting), pad to common length.
    bed_stems = [load_stereo(os.path.join(cfg["src"], f)) for f in cfg["bed"]
                 if os.path.exists(os.path.join(cfg["src"], f))]
    vox_stems = [load_stereo(os.path.join(cfg["src"], f)) for f in cfg["vox"]
                 if os.path.exists(os.path.join(cfg["src"], f))]
    N = max(y.shape[1] for y in (bed_stems + vox_stems))

    def pad(y):
        return np.pad(y, ((0, 0), (0, N - y.shape[1]))) if y.shape[1] < N else y[:, :N]

    bed = np.sum([pad(y) for y in bed_stems], axis=0)
    vox = np.sum([pad(y) for y in vox_stems], axis=0) if vox_stems else np.zeros((2, N))
    full_mono = (bed + vox).mean(axis=0)

    start, end = music_bounds(full_mono, bar, beat, beat0)
    print(f"music {start:.2f}->{end:.2f}s ({end - start:.2f}s, {round((end - start) / bar)} bars)")

    segs = tile(start, end, bar)
    print(f"{len(segs)} segments (target {SEG_BARS} bars each):")

    w = int(XF * SR)
    bed_global_peak = np.max(np.abs(bed)) or 1.0
    manifest_segs = []
    prev_vox_present = False
    def loop_click(y_mono):
        pk = np.max(np.abs(y_mono)) or 1.0
        return abs(y_mono[-1] - y_mono[0]) / pk

    for i, (s, e, bars) in enumerate(segs):
        s0, e0 = int(round(s * SR)), int(round(e * SR))
        bseg, vseg = bed[:, s0:e0], vox[:, s0:e0]
        seg_samples = e0 - s0
        # validate whole-bar length
        bars_actual = (seg_samples / SR) / bar
        if abs(bars_actual - bars) > 0.05:
            raise SystemExit(f"FAIL seg{i}: not whole-bar ({bars_actual:.3f} != {bars})")
        if bseg.shape[1] != vseg.shape[1]:
            raise SystemExit(f"FAIL seg{i}: bed/vox length mismatch")

        bed_rms = rms(bseg) / (rms(bed) or 1.0)
        vox_raw_rms = rms(vseg)
        has_vox = vox_raw_rms > 0.01 * (np.max(np.abs(vox)) or 1.0)

        bout = norm(loop_crossfade(bseg, w), TARGET_PEAK)
        vout = loop_crossfade(vseg, w)
        if np.max(np.abs(vout)) > 0.01:
            vout = norm(vout, min(VOX_PEAK, TARGET_PEAK))

        # hard gate: the loop point must be click-free
        for kind, data in (("bed", bout), ("vox", vout)):
            click = loop_click(data.mean(axis=0))
            if click > 0.06:
                raise SystemExit(
                    f"FAIL seg{i}-{kind}: loop click {click:.3f} > 0.06 (not click-free)")

        char = character(bed_rms, vox_raw_rms, has_vox, prev_vox_present)
        prev_vox_present = has_vox

        for kind, data in (("bed", bout), ("vox", vout)):
            wavp = os.path.join(tempfile.gettempdir(), f"{key}_seg{i}-{kind}.wav")
            mp3p = os.path.join(cfg["out"], f"seg{i}-{kind}.mp3")
            sf.write(wavp, data.T, SR)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wavp,
                            "-ar", "44100", "-ac", "2", "-b:a", "160k", mp3p], check=True)

        manifest_segs.append({
            "index": i,
            "bars": int(bars),
            "lengthSeconds": round(seg_samples / SR, 4),
            "startSeconds": round(s, 4),
            "character": char,
            "hasVox": bool(has_vox),
            "bedRms": round(rms(bout), 5),
            "voxRms": round(rms(vout), 5),
            "bed": f"seg{i}-bed.mp3",
            "vox": f"seg{i}-vox.mp3",
        })
        print(f"  seg{i}: {s:6.2f}->{e:6.2f}s {bars}b  {char:11s} hasVox={has_vox}")

    manifest = {
        "id": key,
        "name": cfg["name"],
        "tempo": round(tempo, 3),
        "barSeconds": round(bar, 5),
        "segBars": SEG_BARS,
        "musicStart": round(start, 3),
        "musicEnd": round(end, 3),
        "segmentCount": len(manifest_segs),
        "segments": manifest_segs,
    }
    mpath = os.path.join(cfg["out"], "manifest.json")
    json.dump(manifest, open(mpath, "w"), indent=2)
    print(f"  -> {mpath} ({len(manifest_segs)} segments)")
    return manifest


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    keys = list(SONGS) if which == "all" else [which]
    for k in keys:
        cut_song(k)
    print("\nDone.")
