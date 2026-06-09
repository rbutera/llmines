#!/usr/bin/env python3
"""
Layer-4 SFX render for the LLMines audio redesign.

song1: ad-lib stabs sliced from the lead vocal stem. Onset-detect, take a short
window per onset, RMS-gate, score by isolation (silence before/after = a clean
stab, not a word inside a phrase) + brightness + punch, curate the best few, and
map to gameplay-action categories:
    move / rotate -> short bright "ah" stabs
    stage         -> a longer "whoop" / rising stab
    drop          -> a chopped vocal hit (punchy, lower)
song2: NO slicing (D5, low budget). A few subtle in-key sine/triangle tones
derived from the song key, short and understated, for move/rotate/stage/drop.

Each SFX is trimmed, fades applied (no clicks), peak-guarded, loudness-normalized
to ~-14 LUFS. Outputs build/wav/sfx/<song>/<name>.wav + a per-song sfx report.

Run: .venv-audio/bin/python scripts/audio/render-sfx.py
"""
import json
import os
import subprocess
import numpy as np
import soundfile as sf
import librosa

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT = os.path.join(ROOT, "build", "wav", "sfx")
REPORTS = os.path.join(ROOT, "build-reports")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
SR = 48000
TARGET_LUFS = -14.0


def loudnorm(in_path, out_path, target=TARGET_LUFS):
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", in_path,
                    "-af", f"loudnorm=I={target}:TP=-1.5:LRA=11",
                    "-ar", str(SR), "-c:a", "pcm_s24le", out_path], check=True)


def apply_fades(buf, fade_ms=8):
    n = buf.shape[0]
    f = min(int(fade_ms / 1000 * SR), n // 2)
    if f < 1:
        return buf
    win = np.linspace(0, 1, f, dtype=np.float32)[:, None] if buf.ndim == 2 else np.linspace(0, 1, f, dtype=np.float32)
    buf[:f] *= win
    buf[n - f:] *= win[::-1]
    return buf


def peak_norm(buf, ceiling=0.97):
    peak = float(np.abs(buf).max())
    if peak > 1e-6:
        buf = buf * (min(ceiling / peak, 4.0))
    return buf


def slice_song1():
    vpath = os.path.join(SRC, "song1", "7 Vocals.wav")
    d, sr = sf.read(vpath, dtype="float32", always_2d=True)
    mono = d.mean(axis=1)
    n = len(mono)
    onsets = librosa.onset.onset_detect(y=mono, sr=sr, backtrack=True, units="samples")

    cands = []
    max_len = int(0.9 * sr)
    floor = 10 ** (-45 / 20)  # -45 dBFS gate
    for k, on in enumerate(onsets):
        # window: from onset to next onset (cap 0.9s), find content end by RMS gate
        nxt = onsets[k + 1] if k + 1 < len(onsets) else n
        end = min(on + max_len, nxt, n)
        seg = mono[on:end]
        if len(seg) < int(0.04 * sr):
            continue
        # trim trailing near-silence
        env = np.abs(seg)
        active = np.where(env > floor)[0]
        if len(active) == 0:
            continue
        seg = seg[: active[-1] + int(0.02 * sr)]
        dur = len(seg) / sr
        if dur < 0.06 or dur > 0.85:
            continue
        # isolation: silence BEFORE the onset (50ms preceding RMS low) = clean stab
        pre0 = max(0, on - int(0.06 * sr))
        pre_rms = np.sqrt(np.mean(mono[pre0:on] ** 2)) + 1e-9
        peak = float(np.abs(seg).max())
        if peak < 0.05:  # too quiet to be a usable stab
            continue
        rms = float(np.sqrt(np.mean(seg ** 2)))
        # brightness via spectral centroid
        cen = float(librosa.feature.spectral_centroid(y=seg, sr=sr).mean())
        isolation_db = 20 * np.log10((rms + 1e-9) / pre_rms)
        cands.append({
            "onset_s": round(on / sr, 3), "dur": round(dur, 3),
            "peak": round(peak, 3), "rms_db": round(20 * np.log10(rms + 1e-12), 2),
            "centroid": round(cen, 1), "isolation_db": round(isolation_db, 2),
            "samples": seg.astype(np.float32),
        })

    # categorize:
    #  move/rotate: short (<=0.30s), bright (high centroid), well-isolated "ah" stabs
    #  stage: longer (0.30-0.85s), rising/bright "whoop"
    #  drop: punchy, high peak, lower centroid chopped hit
    short_bright = sorted(
        [c for c in cands if c["dur"] <= 0.30 and c["isolation_db"] > 0],
        key=lambda c: (c["centroid"], c["isolation_db"]), reverse=True,
    )
    longer = sorted(
        [c for c in cands if 0.30 < c["dur"] <= 0.85],
        key=lambda c: (c["centroid"] * 0.5 + c["isolation_db"]), reverse=True,
    )
    punchy = sorted(cands, key=lambda c: c["peak"], reverse=True)

    chosen = {}
    if short_bright:
        chosen["move"] = short_bright[0]
        chosen["rotate"] = short_bright[1] if len(short_bright) > 1 else short_bright[0]
    if longer:
        chosen["stage"] = longer[0]
    if punchy:
        # pick a punchy one not already used as move/rotate
        used = {id(chosen.get(k, {}).get("samples", None)) for k in chosen}
        for c in punchy:
            if id(c["samples"]) not in used:
                chosen["drop"] = c
                break
        else:
            chosen["drop"] = punchy[0]
    # softdrop: a quieter short stab (reuse a mid short_bright)
    if len(short_bright) > 2:
        chosen["softdrop"] = short_bright[2]
    return chosen, len(cands), len(onsets)


def tone(freq, dur, kind="tri", attack=0.01, release=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "sine":
        w = np.sin(2 * np.pi * freq * t)
    else:  # triangle (softer than saw, warmer than sine)
        w = 2 * np.abs(2 * (t * freq - np.floor(t * freq + 0.5))) - 1
        w += 0.25 * np.sin(2 * np.pi * freq * 2 * t)  # a touch of 2nd harmonic
    env = np.ones(n, dtype=np.float32)
    a = int(attack * SR)
    r = int(release * SR)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if r > 0:
        env[n - r:] = np.linspace(1, 0, r)
    sig = (w * env).astype(np.float32)
    return np.stack([sig, sig], axis=1)  # stereo


def synth_song2():
    """Subtle in-key tones. song2 'Verde el Pipeline' is a phonk track; pick a
    minor-ish set. Use F minor pentatonic-ish degrees (subtle, understated)."""
    # F3=174.61, Ab3=207.65, C4=261.63, Eb4=311.13, F4=349.23
    return {
        "move":   tone(349.23, 0.10, "tri", release=0.07),  # F4 short blip
        "rotate": tone(311.13, 0.10, "tri", release=0.07),  # Eb4 short blip
        "stage":  tone(261.63, 0.32, "sine", attack=0.02, release=0.18),  # C4 swell
        "drop":   tone(174.61, 0.22, "tri", attack=0.005, release=0.15),  # F3 low thud
        "softdrop": tone(207.65, 0.09, "tri", release=0.06),  # Ab3 soft
    }


def emit(song, items, report):
    outdir = os.path.join(OUT, song)
    os.makedirs(outdir, exist_ok=True)
    song_rep = {}
    for name, payload in items.items():
        buf = payload["samples"] if isinstance(payload, dict) else payload
        if buf.ndim == 1:
            buf = np.stack([buf, buf], axis=1)
        buf = apply_fades(buf.astype(np.float32).copy())
        buf = peak_norm(buf)
        raw = os.path.join(outdir, f"sfx-{name}.raw.wav")
        out = os.path.join(outdir, f"sfx-{name}.wav")
        sf.write(raw, buf, SR, subtype="FLOAT")
        loudnorm(raw, out)
        os.remove(raw)
        meta = {"wav": out, "durSec": round(buf.shape[0] / SR, 3)}
        if isinstance(payload, dict):
            meta.update({k: payload[k] for k in
                         ("onset_s", "centroid", "isolation_db", "peak") if k in payload})
        song_rep[name] = meta
        print(f"  {song} sfx-{name:<9} {meta['durSec']}s "
              + (f"src@{payload.get('onset_s')}s cen={payload.get('centroid')}"
                 if isinstance(payload, dict) else "(synth tone)"))
    report[song] = song_rep


def main():
    report = {}
    print("song1: slicing ad-lib stabs from vocal stem...")
    chosen, ncand, nonset = slice_song1()
    print(f"  onsets={nonset} candidates(after gate)={ncand} chosen={list(chosen)}")
    emit("song1", chosen, report)
    print("song2: subtle in-key tones (D5, no slicing)...")
    emit("song2", synth_song2(), report)
    os.makedirs(REPORTS, exist_ok=True)
    # strip numpy from report
    json.dump(report, open(os.path.join(REPORTS, "sfx-report.json"), "w"), indent=2, default=str)
    print("sfx-report.json written")


if __name__ == "__main__":
    main()
