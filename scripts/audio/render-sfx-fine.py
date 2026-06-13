#!/usr/bin/env python3
"""
B5 — PER-SEGMENT SFX render for the LLMines FINE6 cut.

For EACH segment of EACH song, cut four action one-shots FROM THAT SEGMENT'S OWN
STEMS within its bar window, so the action sounds belong to what is currently
playing (an intro's ad-libs differ from a beat-drop's):

  rotate   — a short bright transient (from Synth / FX / Guitar)
  softdrop — a soft tick           (from Percussion / hat / Drums)
  drop     — a heavier impact      (from Drums kick / Percussion)
  stage    — the clear-reward, a satisfying hit/stab from the segment's most
             characteristic stem, biased by the segment `character`:
               * beat-drop / break / drop  -> its kick / impact (Drums)
               * chorus / vocal sections    -> a vocal-adjacent stab (Synth / Vocals)
               * otherwise                  -> the brightest available stab
  move     — SKIPPED (silent by design; never emitted).

Each one-shot: onset-detected within the segment window, 150-400ms, few-ms fade
in/out (no clicks), peak-normalized to ~-6 dBFS, stereo (matches the existing sfx).
If a segment yields no clean slice for a type, FALL BACK to that song's song-level
sfx (build-fine6/sfx/<song>/_songlevel/sfx-<type>.wav, rendered first from the
existing render-sfx.py logic) so every segment ALWAYS has all four. Every emitted
sfx is validated NON-SILENT (peak > -40 dBFS).

Outputs: build-fine6/sfx/<song>/<segid>/sfx-{rotate,softdrop,drop,stage}.wav
         build-fine6/sfx/<song>/_songlevel/sfx-{...}.wav   (fallback set)
         build-reports/sfx-fine6-report.json

Run: .venv-audio/bin/python scripts/audio/render-sfx-fine.py
"""
import json
import os
import subprocess
import numpy as np
import soundfile as sf
import librosa

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
SRC = os.path.join(ROOT, "audio-src")
OUT = os.path.join(ROOT, "build-fine6", "sfx")
REPORTS = os.path.join(ROOT, "build-reports")
PLAN_PATH = os.path.join(ROOT, "scripts", "audio", "cut-plan-fine.json")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
SR = 48000

PEAK_TARGET = 0.5012  # ~ -6 dBFS
NONSILENT_FLOOR_DB = -40.0  # peak must exceed this
TARGET_LUFS = -14.0

TYPES = ("rotate", "softdrop", "drop", "stage")  # move = silent (skipped)

# Per-song stem role map: which stem files feed which one-shot search.
# (Synth/FX/Guitar = bright; Percussion/hat = tick; Drums kick = impact.)
STEM_ROLES = {
    "song1": {
        "bright": ["2 Synth.wav", "1 FX.wav", "4 Guitar.wav"],
        "tick":   ["3 Percussion.wav", "6 Drums.wav"],
        "impact": ["6 Drums.wav", "3 Percussion.wav"],
        "vocal":  ["7 Vocals.wav"],
        "all":    ["1 FX.wav", "2 Synth.wav", "3 Percussion.wav", "4 Guitar.wav",
                   "5 Bass.wav", "6 Drums.wav", "7 Vocals.wav"],
    },
    "song2": {
        "bright": ["2 Synth.wav", "1 FX.wav"],
        "tick":   ["4 Drums.wav"],
        "impact": ["4 Drums.wav"],
        "vocal":  ["6 Vocals.wav", "5 Backing_Vocals.wav"],
        "all":    ["1 FX.wav", "2 Synth.wav", "3 Bass.wav", "4 Drums.wav",
                   "5 Backing_Vocals.wav", "6 Vocals.wav"],
    },
}

# duration bands (seconds): (min, max, preferred)
DUR_BAND = {
    "rotate":   (0.15, 0.30),
    "softdrop": (0.15, 0.25),
    "drop":     (0.20, 0.40),
    "stage":    (0.25, 0.40),
}


def bar_to_sample(bar, sec_per_bar, origin):
    return int(round((origin + bar * sec_per_bar) * SR))


def load_mono_window(song, name, i0, i1):
    """Load a stem and return the mono slice [i0:i1] (cached per stem file)."""
    d, sr = sf.read(os.path.join(SRC, song, name), dtype="float32", always_2d=True,
                    start=i0, stop=i1)
    assert sr == SR
    return d.mean(axis=1)


def apply_fades(buf, fade_ms=5):
    n = buf.shape[0]
    f = min(int(fade_ms / 1000 * SR), n // 2)
    if f < 1:
        return buf
    if buf.ndim == 2:
        win = np.linspace(0, 1, f, dtype=np.float32)[:, None]
    else:
        win = np.linspace(0, 1, f, dtype=np.float32)
    buf[:f] *= win
    buf[n - f:] *= win[::-1]
    return buf


def peak_norm(buf, ceiling=PEAK_TARGET):
    peak = float(np.abs(buf).max())
    if peak > 1e-6:
        buf = buf * (min(ceiling / peak, 8.0))
    return buf


def peak_db(buf):
    p = float(np.abs(buf).max())
    return 20 * np.log10(p + 1e-12)


def best_onset_slice(mono, dmin, dmax, prefer="bright"):
    """Onset-detect in `mono`, score windows, return the best (samples, meta) or None.
    `prefer`: 'bright' (high centroid), 'impact' (high peak + low centroid),
    'tick' (short + punchy), 'vocal' (mid centroid + isolated)."""
    n = len(mono)
    if n < int(dmin * SR):
        return None
    try:
        onsets = librosa.onset.onset_detect(y=mono, sr=SR, backtrack=True,
                                             units="samples")
    except Exception:  # noqa: BLE001
        onsets = np.array([], dtype=int)
    if len(onsets) == 0:
        # no onset — fall back to the loudest dmax window via a sliding RMS
        win = int(dmax * SR)
        if n <= win:
            onsets = np.array([0])
        else:
            step = max(1, win // 4)
            best_i, best_r = 0, -1.0
            for s in range(0, n - win, step):
                r = float(np.sqrt(np.mean(mono[s:s + win] ** 2)))
                if r > best_r:
                    best_r, best_i = r, s
            onsets = np.array([best_i])

    floor = 10 ** (-45 / 20)
    cands = []
    max_len = int(dmax * SR)
    for k, on in enumerate(onsets):
        nxt = onsets[k + 1] if k + 1 < len(onsets) else n
        end = min(on + max_len, nxt, n)
        seg = mono[on:end]
        if len(seg) < int(dmin * SR):
            # too short to the next onset — pad up to dmin from the source if room
            end2 = min(on + int(dmin * SR), n)
            seg = mono[on:end2]
            if len(seg) < int(dmin * SR):
                continue
        env = np.abs(seg)
        active = np.where(env > floor)[0]
        if len(active) == 0:
            continue
        seg = seg[: min(len(seg), active[-1] + int(0.02 * SR))]
        if len(seg) < int(dmin * SR):
            seg = mono[on:min(on + int(dmin * SR), n)]
        dur = len(seg) / SR
        if dur < dmin * 0.9:
            continue
        peak = float(np.abs(seg).max())
        if peak < 0.02:
            continue
        rms = float(np.sqrt(np.mean(seg ** 2)))
        try:
            cen = float(librosa.feature.spectral_centroid(y=seg, sr=SR).mean())
        except Exception:  # noqa: BLE001
            cen = 0.0
        pre0 = max(0, on - int(0.05 * SR))
        pre_rms = np.sqrt(np.mean(mono[pre0:on] ** 2)) + 1e-9
        iso = 20 * np.log10((rms + 1e-9) / pre_rms)
        cands.append({"on": int(on), "dur": dur, "peak": peak, "rms": rms,
                      "cen": cen, "iso": iso, "samples": seg.astype(np.float32)})
    if not cands:
        return None

    if prefer == "bright":
        cands.sort(key=lambda c: (c["cen"], c["iso"]), reverse=True)
    elif prefer == "impact":
        cands.sort(key=lambda c: (c["peak"] * 1.0 - c["cen"] / 8000.0), reverse=True)
    elif prefer == "tick":
        cands.sort(key=lambda c: (c["peak"], -c["dur"]), reverse=True)
    elif prefer == "vocal":
        cands.sort(key=lambda c: (c["iso"] + c["cen"] / 4000.0), reverse=True)
    else:
        cands.sort(key=lambda c: c["peak"], reverse=True)
    best = cands[0]
    return best


def search_type(song, role_stems, i0, i1, dmin, dmax, prefer):
    """Search each candidate stem in the segment window; return best slice meta."""
    best = None
    best_src = None
    for name in role_stems:
        mono = load_mono_window(song, name, i0, i1)
        cand = best_onset_slice(mono, dmin, dmax, prefer=prefer)
        if cand is None:
            continue
        key = (cand["peak"] if prefer in ("impact", "tick") else cand["cen"])
        if best is None or key > (best["peak"] if prefer in ("impact", "tick")
                                  else best["cen"]):
            best = cand
            best_src = name
    if best is not None:
        best["src"] = best_src
    return best


def stage_role_for(character):
    c = (character or "").lower()
    if any(w in c for w in ("beat drop", "beatdrop", "drop", "break", "outro", "seam")):
        return "impact"
    if any(w in c for w in ("chorus", "vocal", "verse", "build", "bridge")):
        return "vocal"
    return "bright"


def loudnorm_to_wav(buf, out_path):
    """Stereo-ize, fade, peak-norm, loudnorm to a consistent level, write 24-bit."""
    if buf.ndim == 1:
        buf = np.stack([buf, buf], axis=1)
    buf = apply_fades(buf.astype(np.float32).copy())
    buf = peak_norm(buf)
    raw = out_path + ".raw.wav"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sf.write(raw, buf, SR, subtype="FLOAT")
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", raw,
                    "-af", f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11",
                    "-ar", str(SR), "-c:a", "pcm_s24le", out_path], check=True)
    os.remove(raw)
    d, _ = sf.read(out_path, dtype="float32", always_2d=True)
    return float(np.abs(d).max())


def render_song_level(song):
    """Render a per-song FALLBACK set from the WHOLE-song stems (the safety net).
    Same role logic, searched over the full song so it always yields all four."""
    sl_dir = os.path.join(OUT, song, "_songlevel")
    roles = STEM_ROLES[song]
    total = sf.info(os.path.join(SRC, song, roles["all"][0])).frames
    out = {}
    plan = {
        "rotate": ("bright", *DUR_BAND["rotate"]),
        "softdrop": ("tick", *DUR_BAND["softdrop"]),
        "drop": ("impact", *DUR_BAND["drop"]),
        "stage": ("bright", *DUR_BAND["stage"]),
    }
    for t, (prefer, dmin, dmax) in plan.items():
        role_stems = roles[{"bright": "bright", "tick": "tick",
                            "impact": "impact"}[prefer]]
        best = search_type(song, role_stems, 0, total, dmin, dmax, prefer)
        if best is None:
            # last resort: brightest from 'all'
            best = search_type(song, roles["all"], 0, total, dmin, dmax, "bright")
        out_path = os.path.join(sl_dir, f"sfx-{t}.wav")
        pk = loudnorm_to_wav(best["samples"] if best else
                             np.zeros(int(0.2 * SR), dtype=np.float32), out_path)
        out[t] = {"wav": out_path, "peakDb": round(20 * np.log10(pk + 1e-12), 2),
                  "src": best.get("src") if best else None}
    return out


def main():
    plan = json.load(open(PLAN_PATH))
    report = {"songs": {}, "fallbacks": [], "peakFloorDb": NONSILENT_FLOOR_DB,
              "types": list(TYPES)}
    counts = {"emitted": 0, "fromSegment": 0, "fallback": 0, "silentFail": 0}

    for song in ("song1", "song2"):
        sp = plan[song]
        spb, origin = sp["secPerBar"], sp["origin"]
        print(f"{song}: rendering song-level fallback set...")
        songlevel = render_song_level(song)
        song_rep = {"songLevel": songlevel, "segments": {}}

        for seg in sp["segments"]:
            sb, eb = seg["startBar"], seg["endBar"]
            i0 = bar_to_sample(sb, spb, origin)
            i1 = bar_to_sample(eb + 1, spb, origin)
            segdir = os.path.join(OUT, song, seg["id"])
            roles = STEM_ROLES[song]
            seg_out = {}
            for t in TYPES:
                if t == "stage":
                    prefer = stage_role_for(seg.get("character"))
                    role_key = {"impact": "impact", "vocal": "vocal",
                                "bright": "bright"}[prefer]
                    dmin, dmax = DUR_BAND["stage"]
                elif t == "rotate":
                    prefer, role_key = "bright", "bright"
                    dmin, dmax = DUR_BAND["rotate"]
                elif t == "softdrop":
                    prefer, role_key = "tick", "tick"
                    dmin, dmax = DUR_BAND["softdrop"]
                else:  # drop
                    prefer, role_key = "impact", "impact"
                    dmin, dmax = DUR_BAND["drop"]

                best = search_type(song, roles[role_key], i0, i1, dmin, dmax, prefer)
                out_path = os.path.join(segdir, f"sfx-{t}.wav")
                used_fallback = False
                if best is not None:
                    pk = loudnorm_to_wav(best["samples"], out_path)
                    if 20 * np.log10(pk + 1e-12) <= NONSILENT_FLOOR_DB:
                        best = None  # came out silent — force fallback
                if best is None:
                    # FALLBACK: copy the song-level sfx for this type.
                    src = songlevel[t]["wav"]
                    os.makedirs(segdir, exist_ok=True)
                    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", src,
                                    "-c:a", "pcm_s24le", out_path], check=True)
                    d, _ = sf.read(out_path, dtype="float32", always_2d=True)
                    pk = float(np.abs(d).max())
                    used_fallback = True
                    report["fallbacks"].append(f"{song}/{seg['id']}/{t}")
                    counts["fallback"] += 1
                else:
                    counts["fromSegment"] += 1

                pkdb = round(20 * np.log10(pk + 1e-12), 2)
                if pkdb <= NONSILENT_FLOOR_DB:
                    counts["silentFail"] += 1
                counts["emitted"] += 1
                seg_out[t] = {
                    "wav": out_path, "peakDb": pkdb, "fallback": used_fallback,
                    "src": (songlevel[t].get("src") if used_fallback
                            else best.get("src")),
                }
            song_rep["segments"][seg["id"]] = seg_out
            nf = sum(1 for t in TYPES if seg_out[t]["fallback"])
            print(f"  {song} {seg['id']:<13} "
                  + " ".join(f"{t}={seg_out[t]['peakDb']:.0f}"
                            + ("*" if seg_out[t]["fallback"] else "")
                            for t in TYPES)
                  + (f"  ({nf} fallback)" if nf else ""))
        report["songs"][song] = song_rep

    report["counts"] = counts
    os.makedirs(REPORTS, exist_ok=True)
    json.dump(report, open(os.path.join(REPORTS, "sfx-fine6-report.json"), "w"),
              indent=2, default=str)
    print(f"\nemitted={counts['emitted']} fromSegment={counts['fromSegment']} "
          f"fallback={counts['fallback']} silentFail={counts['silentFail']}")
    print("sfx-fine6-report.json written")


if __name__ == "__main__":
    main()
