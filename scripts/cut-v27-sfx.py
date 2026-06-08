#!/usr/bin/env python3
"""
v2.7 action-SFX extraction (song1 only — song2 uses procedural in-key tones).

Rai named specific ad-lib one-shots and which game ACTION each should drive (the
analysis in vault/reviews/llmines-v27/song1-structure-analysis.md):

  - recurring "ah ah ah"  (intro, very frequent first ~36s) -> MOVE + ROTATE
  - high "whoop"          (~0:36)                            -> stage (insta-drop)
  - chopped vocals        (~1:30)                            -> rotate alt / softdrop
  - (back-half crash / "ship it" are beyond the truncated stems — unavailable)

These are pulled from the lead-vocal stem at the named times, trimmed to the
transient, level-normalised, and encoded to public/audio/sfx-*.mp3. CLEARS get NO
SFX (silent by design) so there is no clear/stage-on-clear sound here.

Reproducible. venv ~/dev/sdd-eval/.audio-venv (librosa + ffmpeg).
Usage: python3 scripts/cut-v27-sfx.py
"""

import os
import subprocess
import tempfile

import librosa
import numpy as np
import soundfile as sf

SR = 44100
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEMS = os.path.expanduser("~/dev/sdd-eval/sem-final-stems/v2")
OUT = os.path.join(REPO, "public", "audio")
LEAD = "0 Lead Vocals.mp3"
BACK = "1 Backing Vocals.mp3"

# name -> (stem, start_sec, max_len_sec). Times are Rai's guidance; we trim to the
# transient inside the window so the slice is a tight one-shot.
SLICES = {
    "move": (BACK, 6.0, 0.9),      # "ah" from the recurring intro ad-lib
    "rotate": (BACK, 8.2, 0.9),    # a different "ah" so move/rotate aren't identical
    "stage": (LEAD, 36.0, 1.2),    # the high "whoop" ~0:36
    "softdrop": (LEAD, 90.0, 0.6), # a chopped vocal ~1:30
    "harddrop": (LEAD, 92.0, 1.0), # a chopped vocal ~1:30 (heavier) for the slam
}


def load(path):
    return librosa.load(path, sr=SR, mono=False)[0]


def to_stereo(y):
    if y.ndim == 1:
        return np.stack([y, y])
    return y


def trim_to_transient(seg, max_len_sec):
    """Find the onset in the window, trim to [onset, onset+max_len], fade in/out."""
    mono = seg.mean(axis=0)
    n = seg.shape[1]
    if n == 0:
        return seg
    # onset = first sample above 12% of window peak
    pk = np.max(np.abs(mono)) or 1.0
    above = np.where(np.abs(mono) > 0.12 * pk)[0]
    start = int(above[0]) if len(above) else 0
    end = min(n, start + int(max_len_sec * SR))
    out = seg[:, start:end].copy()
    # short fades to avoid clicks
    f = min(256, out.shape[1] // 8)
    if f > 1:
        ramp = np.linspace(0, 1, f)
        out[:, :f] *= ramp
        out[:, -f:] *= ramp[::-1]
    # normalise
    p = np.max(np.abs(out)) or 1.0
    out = out / p * 0.9
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    cache = {}
    for name, (stem, start, maxlen) in SLICES.items():
        if stem not in cache:
            cache[stem] = to_stereo(load(os.path.join(STEMS, stem)))
        y = cache[stem]
        s0 = int(start * SR)
        e0 = min(y.shape[1], s0 + int((maxlen + 0.5) * SR))
        if s0 >= y.shape[1]:
            print(f"  SKIP {name}: start {start}s beyond stem")
            continue
        clip = trim_to_transient(y[:, s0:e0], maxlen)
        wavp = os.path.join(tempfile.gettempdir(), f"sfx_{name}.wav")
        mp3p = os.path.join(OUT, f"sfx-{name}.mp3")
        sf.write(wavp, clip.T, SR)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wavp,
             "-ar", "44100", "-ac", "2", "-b:a", "192k", mp3p],
            check=True,
        )
        print(f"  sfx-{name}.mp3  ({clip.shape[1] / SR:.2f}s from {stem} @ {start}s)")
    print(f"  -> {OUT}/sfx-*.mp3")


if __name__ == "__main__":
    main()
