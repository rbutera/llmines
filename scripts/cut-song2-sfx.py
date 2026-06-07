#!/usr/bin/env python3
"""
Curate the 8 ad-lib SFX one-shots for song 2 from sem-final-stems/song2/adlibs
into public/audio/song2/sfx-{name}.mp3 (the engine's SfxName scheme).

Each game action gets an ad-lib chosen to match song1's character:
  - move/rotate  : shortest bright blips (~0.1s)
  - softdrop/lock/match : punchy mids (0.25-0.35s)
  - harddrop     : the biggest/longest punch (~0.58s)
  - gem          : brightest one-shot (high spectral centroid)
  - chain        : bright + a touch longer (the cascade)
The specific slice ids below were picked by the duration/brightness/punch
analysis (see cut analysis); each is leading-silence-trimmed, peak-scaled per
action, given 4ms edge fades (click-free), encoded 44.1kHz stereo 160k MP3.

Requires: librosa, soundfile, numpy, ffmpeg on PATH.
"""

import librosa, numpy as np, soundfile as sf, os, subprocess, tempfile

SRC = os.path.expanduser("~/dev/sdd-eval/sem-final-stems/song2/adlibs")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "public", "audio", "song2")
os.makedirs(OUT, exist_ok=True)
sr = 44100

# action -> source ad-lib slice
mapping = {
    "move": "s2-96.wav", "rotate": "s2-116.wav", "softdrop": "s2-92.wav",
    "lock": "s2-42.wav", "match": "s2-45.wav", "harddrop": "s2-48.wav",
    "gem": "s2-26.wav", "chain": "s2-54.wav",
}
# per-action target peak (blips quieter, hits louder — matches song1 feel)
peak = {"move": 0.5, "rotate": 0.5, "softdrop": 0.6, "lock": 0.8,
        "match": 0.7, "harddrop": 0.9, "gem": 0.85, "chain": 0.85}


def fade_edges(y, ms=4):
    n = min(int(ms / 1000 * sr), len(y) // 4)
    if n < 1:
        return y
    y = y.copy()
    y[:n] *= np.linspace(0, 1, n)
    y[-n:] *= np.linspace(1, 0, n)
    return y


for act, src in mapping.items():
    y, _ = librosa.load(os.path.join(SRC, src), sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    mono = np.mean(np.abs(y), axis=0)
    nz = np.where(mono > 0.005)[0]
    if len(nz):
        y = y[:, max(0, nz[0] - int(0.002 * sr)):nz[-1] + int(0.01 * sr)]
    p = np.max(np.abs(y))
    if p > 1e-6:
        y = y / p * peak[act]
    y = np.stack([fade_edges(y[0]), fade_edges(y[1])])
    wavp = os.path.join(tempfile.gettempdir(), f"s2sfx-{act}.wav")
    mp3p = os.path.join(OUT, f"sfx-{act}.mp3")
    sf.write(wavp, y.T, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wavp,
                    "-ar", "44100", "-ac", "2", "-b:a", "160k", mp3p], check=True)
    print(f"sfx-{act}.mp3 <- {src}  dur={y.shape[1] / sr:.3f}s")

print("Done: 8 SFX.")
