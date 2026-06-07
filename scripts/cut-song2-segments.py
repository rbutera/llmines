#!/usr/bin/env python3
"""
Cut song 2 ("Verde el Pipeline", phonk) into the 6 ordered segment loops + 8
ad-lib SFX the interactive-audio engine expects under public/audio/song2/.

This is the SAME segment recipe song 1 uses (see engine.ts segment model):
  - 6 sequential 8-bar windows across the track, each producing:
      seg{i}-bed.mp3  = the instrumental (Drums + Bass + Synth + Other)
      seg{i}-vox.mp3  = the Lead Vocals
    all the SAME length so they loop in phase and segment crossfades land on the
    bar grid.
  - song2 tempo = 126.0 BPM (librosa-detected; beat_std ~5ms on the overlaid bed
    confirms the stems are synchronized at t=0 — the differing per-stem first
    onsets are just instruments entering at different bars).
  - 8-bar window = 8 * 4 * (60/126) = 15.238s.
  - anchor = 13.0148s (the downbeat where the full arrangement drops).
  - each loop gets a 200ms equal-power crossfade-wrap so it loops click-free,
    normalized to peak 0.89 (matches song1), encoded 44.1kHz stereo 160k MP3.

The 8 ad-lib SFX are curated from sem-final-stems/song2/adlibs (mapped to game
actions by duration/brightness/punch) — see cut-song2-sfx.py.

Requires: librosa, soundfile, numpy, ffmpeg on PATH.
Run from anywhere; paths are absolute to the stems + this repo's public/audio.
"""

import librosa, numpy as np, soundfile as sf, os, subprocess, tempfile

SRC = os.path.expanduser("~/dev/sdd-eval/sem-final-stems/song2/v2")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "public", "audio", "song2")
os.makedirs(OUT, exist_ok=True)

sr = 44100
BPM = 126.0
beat = 60.0 / BPM
bar = beat * 4
SEG_LEN = bar * 8          # 8-bar window, ~15.238s
ANCHOR = 13.0148           # downbeat where the full arrangement drops
N_SEG = 6
XF = 0.20                  # 200ms equal-power crossfade-wrap
TARGET_PEAK = 0.89         # match song1's normalized peak


def load_stereo(fn):
    y, _ = librosa.load(os.path.join(SRC, fn), sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y  # (2, N)


# Percussion stem in song2/v2 is silent, so it is omitted from the bed.
stems = {
    "drums": "1 Drums.mp3", "bass": "2 Bass.mp3",
    "synth": "4 Synth.mp3", "other": "5 Other.mp3", "vox": "0 Lead Vocals.mp3",
}
ys = {k: load_stereo(v) for k, v in stems.items()}
N = max(y.shape[1] for y in ys.values())


def pad(y):
    return np.pad(y, ((0, 0), (0, N - y.shape[1]))) if y.shape[1] < N else y[:, :N]


ys = {k: pad(v) for k, v in ys.items()}

# Bed = full instrumental; Vox = lead vocals.
bed = ys["drums"] + ys["bass"] + 0.8 * ys["synth"] + 0.8 * ys["other"]
vox = ys["vox"]


def crossfade_wrap(seg, w):
    """Equal-power crossfade the tail into the head so the loop is click-free."""
    out = seg.copy()
    t = np.linspace(0, np.pi / 2, w)
    fade_out, fade_in = np.cos(t), np.sin(t)
    head, tail = seg[:, :w], seg[:, -w:]
    out[:, -w:] = tail * fade_out + head * fade_in
    return out


def norm(seg, peak):
    p = np.max(np.abs(seg))
    return seg / p * peak if p > 1e-9 else seg


w = int(XF * sr)
seg_samples = int(round(SEG_LEN * sr))
for i in range(N_SEG):
    s = int(round((ANCHOR + i * SEG_LEN) * sr))
    bseg, vseg = bed[:, s:s + seg_samples], vox[:, s:s + seg_samples]
    if bseg.shape[1] < seg_samples:
        bseg = np.pad(bseg, ((0, 0), (0, seg_samples - bseg.shape[1])))
    if vseg.shape[1] < seg_samples:
        vseg = np.pad(vseg, ((0, 0), (0, seg_samples - vseg.shape[1])))
    bseg = norm(crossfade_wrap(bseg, w), TARGET_PEAK)
    vseg = crossfade_wrap(vseg, w)
    if np.max(np.abs(vseg)) > 0.01:
        vseg = norm(vseg, min(TARGET_PEAK, 0.85))
    for kind, data in [("bed", bseg), ("vox", vseg)]:
        wavp = os.path.join(tempfile.gettempdir(), f"s2_seg{i}-{kind}.wav")
        mp3p = os.path.join(OUT, f"seg{i}-{kind}.mp3")
        sf.write(wavp, data.T, sr)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wavp,
                        "-ar", "44100", "-ac", "2", "-b:a", "160k", mp3p], check=True)
    print(f"seg{i}: start={ANCHOR + i * SEG_LEN:7.3f}s -> {OUT}/seg{i}-{{bed,vox}}.mp3")

print(f"\nDone: {N_SEG} segments ({SEG_LEN:.3f}s each, 8 bars @ {BPM} BPM).")
