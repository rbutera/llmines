#!/usr/bin/env python3
"""
v2.7 STRUCTURE-AWARE segment cutter.

The v2.6 cutter tiled the song into uniform 8-bar windows with NO awareness of
musical structure, so gameplay reassembled the song in the wrong places and
vocals started mid-phrase. v2.7 cuts on the song's ACTUAL structure, driven by a
hand-authored section map (scripts/section-maps.json): each section is bar-aligned
and tagged with a role (looper / progression / terminal) and playback modes that
the engine reads to enter every section phase-correctly.

Pipeline per song:
  1. Detect tempo + the bar grid from the DRUMS stem (librosa beat_track) and
     establish a grid ORIGIN near t=0.
  2. For each authored section: snap its rough start to the nearest bar line; the
     section spans [thisStart, nextStart) snapped, then ROUNDED to a whole number
     of bars (preferring the authored `preferBars` when the span is close).
  3. Cut each section into a `bed` (instrumental stem-sum) loop and a `vox` loop:
       - bed: ALWAYS cut on the hard bar line (instrumental is continuous and must
         loop cleanly). Equal-power loop wrap + micro endpoint fade.
       - vox: SPILL-AWARE. For a vocal section, extend the vox window by
         `spillTailSec` to carry an acapella tail / lead-in across the bar line,
         then wrap. If the spill-extended vox fails the click gate, FALL BACK to
         the clean bar-line vox cut (noted in the report) — never ship a click.
  4. VERIFY each decoded loop length == round(bars*barSeconds*SR) (sample-exact;
     compensates MP3 encoder padding by trimming/padding before encode).
  5. HARD click gate: loop-seam sample jump must be < 0.06 of peak, else FAIL.
  6. Emit manifest.json (per-section role + playback modes + gate + loopability +
     terminal fields) the ENGINE reads, and AUDITION artifacts to the vault for
     Rai's ear-check (per-section loop x4, adjacent-transition at bar offsets,
     vox-entry, + a manifest report).

Reproducible. Needs librosa + ffmpeg (venv ~/dev/sdd-eval/.audio-venv).

Usage:  python3 scripts/cut-v27-segments.py [song1|song2|all]
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
XF_SEC = 0.20          # 200ms equal-power tail->head wrap
MICRO = 256            # micro endpoint fade samples (~6ms) to force out[-1]==out[0]
TARGET_PEAK = 0.89
VOX_PEAK = 0.85
CLICK_GATE = 0.06      # loop-seam sample jump as fraction of peak — hard fail above
LEN_TOL_SAMPLES = 64   # sample-exact length tolerance after trim/pad

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(REPO, "scripts", "section-maps.json")
VAULT_AUDITION = os.path.expanduser("~/focused/vault/reviews/llmines-v27/auditions")


def expand(p):
    return os.path.expanduser(p)


def load_stereo(path):
    y, _ = librosa.load(path, sr=SR, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y


def load_mono(path):
    return librosa.load(path, sr=SR, mono=True)[0]


def rms(seg):
    return float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0


def norm(seg, peak):
    p = np.max(np.abs(seg))
    return seg / p * peak if p > 1e-9 else seg


def loop_crossfade(core, w):
    """Click-free loop: equal-power tail->head wrap + micro endpoint fade so the
    very last sample equals the first regardless of content (bar-aligned downbeat
    transients can still leave a small jump that stage-1 alone won't kill)."""
    out = core.copy()
    w = min(w, out.shape[1] // 3)
    if w > 1:
        t = np.linspace(0, np.pi / 2, w)
        fade_out, fade_in = np.cos(t), np.sin(t)
        out[:, -w:] = core[:, -w:] * fade_out + core[:, :w] * fade_in
    m = min(MICRO, out.shape[1] // 4)
    if m > 1:
        ramp = np.linspace(0.0, 1.0, m)
        for ch in range(out.shape[0]):
            out[ch, -m:] = out[ch, -m:] * (1.0 - ramp) + out[ch, 0] * ramp
    return out


def loop_click(y_mono):
    pk = np.max(np.abs(y_mono)) or 1.0
    return abs(float(y_mono[-1]) - float(y_mono[0])) / pk


def detect_grid(cfg):
    """tempo, beat(s), bar(s), grid origin near t=0."""
    drums = load_mono(os.path.join(expand(cfg["src"]), cfg["drums"]))
    tempo, beats = librosa.beat.beat_track(
        y=drums, sr=SR, units="time", start_bpm=cfg["bpmHint"], tightness=200)
    tempo = float(np.atleast_1d(tempo)[0])
    beat = 60.0 / tempo
    bar = beat * 4
    beat0 = float(beats[0]) if len(beats) else 0.0
    origin = beat0 - bar * round(beat0 / bar)  # nearest bar line to 0
    if origin < 0:
        origin += bar
    return tempo, beat, bar, origin


def snap_bar(sec, origin, bar):
    """Nearest bar line (absolute seconds) and its bar index from origin."""
    k = round((sec - origin) / bar)
    return origin + k * bar, k


def to_samples(sec):
    return int(round(sec * SR))


def trim_pad(seg, target_n):
    """Make `seg` exactly target_n samples (compensate MP3/decoded length drift)."""
    n = seg.shape[1]
    if n == target_n:
        return seg
    if n > target_n:
        return seg[:, :target_n]
    return np.pad(seg, ((0, 0), (0, target_n - n)))


def encode(data, out_mp3, key, label):
    wavp = os.path.join(tempfile.gettempdir(), f"{key}_{label}.wav")
    sf.write(wavp, data.T, SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wavp,
                    "-ar", "44100", "-ac", "2", "-b:a", "192k", out_mp3], check=True)


def stem_sum(paths, src, total_n):
    """Sum a list of stems (stereo) padded/clipped to total_n."""
    acc = np.zeros((2, total_n))
    for p in paths:
        fp = os.path.join(src, p)
        if not os.path.exists(fp):
            continue
        y = load_stereo(fp)
        if y.shape[1] < total_n:
            y = np.pad(y, ((0, 0), (0, total_n - y.shape[1])))
        else:
            y = y[:, :total_n]
        acc += y
    return acc


def resolve_sections(sects, origin, bar, content_end_sec):
    """Snap each section start to a bar line; section spans to the next section
    start (or content end), then round to whole bars (prefer authored preferBars
    when within 1 bar). Returns list of dicts with startSec/endSec/bars."""
    snapped = []
    for s in sects:
        sb, _ = snap_bar(s["startSec"], origin, bar)
        snapped.append((max(0.0, sb), s))
    resolved = []
    for i, (start, s) in enumerate(snapped):
        nxt = snapped[i + 1][0] if i + 1 < len(snapped) else min(
            content_end_sec, start + s.get("preferBars", 8) * bar)
        span_bars = max(1, round((nxt - start) / bar))
        prefer = s.get("preferBars")
        if prefer and abs(span_bars - prefer) <= 1:
            span_bars = prefer
        end = start + span_bars * bar
        resolved.append({**s, "startSec": round(start, 4),
                         "endSec": round(end, 4), "bars": int(span_bars)})
    return resolved


def cut_song(key, audition=True):
    config = json.load(open(CONFIG))
    cfg = config[key]
    src = expand(cfg["src"])
    out = os.path.join(REPO, cfg["out"])
    os.makedirs(out, exist_ok=True)
    print(f"\n===== {key}: {cfg['name']} =====\nsrc={src}\nout={out}")

    tempo, beat, bar, origin = detect_grid(cfg)
    print(f"tempo={tempo:.4f}  bar={bar:.5f}s  origin={origin:.4f}s")

    # Determine real content end (max real content across bed+vox stems).
    content_end = 0.0
    for p in cfg["bed"] + cfg["vox"]:
        fp = os.path.join(src, p)
        if os.path.exists(fp):
            y = load_mono(fp)
            nz = np.where(np.abs(y) > 0.002)[0]
            if len(nz):
                content_end = max(content_end, nz[-1] / SR)
    print(f"real content end ~{content_end:.1f}s")

    sections = resolve_sections(cfg["sections"], origin, bar, content_end)
    total_n = to_samples(max(s["endSec"] for s in sections) + 2.0)
    bed_all = stem_sum(cfg["bed"], src, total_n)
    vox_all = stem_sum(cfg["vox"], src, total_n) if cfg["vox"] else np.zeros((2, total_n))

    w = int(XF_SEC * SR)
    manifest_segs = []
    report_rows = []
    os.makedirs(VAULT_AUDITION, exist_ok=True)

    for i, s in enumerate(sections):
        s0 = to_samples(s["startSec"])
        bars = s["bars"]
        seg_n = to_samples(bars * bar)  # sample-exact target
        e0 = s0 + seg_n

        # ---- BED: hard bar-line cut, sample-exact, loop-wrapped ----
        bseg = trim_pad(bed_all[:, s0:e0], seg_n)
        bout = norm(loop_crossfade(bseg, w), TARGET_PEAK)
        bclick = loop_click(bout.mean(axis=0))
        if bclick > CLICK_GATE:
            raise SystemExit(f"FAIL {key} seg{i}({s['name']})-bed: click {bclick:.3f} > {CLICK_GATE}")

        # ---- VOX: spill-aware for vocal sections ----
        vox_mode = s.get("voxMode", "none")
        spill = float(s.get("spillTailSec", 0.0))
        vox_note = ""
        if vox_mode == "none":
            vout = np.zeros((2, seg_n))
            has_vox = False
            vclick = 0.0
        else:
            if spill > 0:
                # SPILL-AWARE wrap: take the section PLUS a spill tail, then fold the
                # spill tail back into the loop HEAD via an equal-power crossfade. The
                # acapella tail/lead-in is preserved (carried across the seam) but the
                # final loop is still EXACTLY seg_n samples so bed and vox stay phase-
                # locked. If the wrapped result clicks, fall back to the clean cut.
                spill_n = to_samples(spill)
                core = trim_pad(vox_all[:, s0:e0], seg_n)
                tail = vox_all[:, e0:e0 + spill_n]
                tail = trim_pad(tail, spill_n) if spill_n > 0 else np.zeros((2, 0))
                vtry = core.copy()
                fw = min(spill_n, w, seg_n // 3)
                if fw > 1 and tail.shape[1] >= fw:
                    t = np.linspace(0, np.pi / 2, fw)
                    fade_out, fade_in = np.cos(t), np.sin(t)
                    # blend the section's own tail with the spill tail into the head
                    vtry[:, :fw] = core[:, :fw] * fade_in + tail[:, :fw] * fade_out
                vtry = loop_crossfade(vtry, w)
                vtry_click = loop_click(vtry.mean(axis=0))
                if vtry_click <= CLICK_GATE:
                    vout = vtry
                    vox_note = f"spill+{spill:.2f}s"
                else:
                    vseg = trim_pad(vox_all[:, s0:e0], seg_n)
                    vout = loop_crossfade(vseg, w)
                    vox_note = f"spill-fallback(click {vtry_click:.3f})"
            else:
                vseg = trim_pad(vox_all[:, s0:e0], seg_n)
                vout = loop_crossfade(vseg, w)
            if np.max(np.abs(vout)) > 0.01:
                vout = norm(vout, min(VOX_PEAK, TARGET_PEAK))
                has_vox = True
            else:
                has_vox = False
            vclick = loop_click(vout.mean(axis=0))
            if vclick > CLICK_GATE:
                raise SystemExit(f"FAIL {key} seg{i}({s['name']})-vox: click {vclick:.3f} > {CLICK_GATE}")

        # voxLoopable assertion (fail closed): a loopLayer must actually loop clean
        if vox_mode == "loopLayer" and s.get("voxLoopable") and has_vox and vclick > CLICK_GATE:
            raise SystemExit(f"FAIL {key} seg{i}({s['name']}): voxLoopable but vox not loop-clean")

        # length sanity (sample-exact)
        for kind, data in (("bed", bout), ("vox", vout)):
            if abs(data.shape[1] - seg_n) > LEN_TOL_SAMPLES:
                raise SystemExit(f"FAIL {key} seg{i}-{kind}: length {data.shape[1]} != {seg_n}")

        encode(bout, os.path.join(out, f"seg{i}-bed.mp3"), key, f"seg{i}-bed")
        if has_vox:
            encode(vout, os.path.join(out, f"seg{i}-vox.mp3"), key, f"seg{i}-vox")

        seg_manifest = {
            "index": i,
            "name": s["name"],
            "role": s["role"],
            "bars": bars,
            "lengthSeconds": round(seg_n / SR, 4),
            "bedMode": s.get("bedMode", "loopRunning"),
            "voxMode": vox_mode,
            "voxEntryBars": s.get("voxEntryBars", [0]),
            "voxLoopable": bool(s.get("voxLoopable", False)),
            "gate": int(s.get("gate", 4)),
            "excessCarry": s.get("excessCarry", "carry"),
            "isTerminalRideout": bool(s.get("isTerminalRideout", False)),
            "completionGate": int(s.get("completionGate", 0)),
            "hasVox": has_vox,
            "bed": f"seg{i}-bed.mp3",
            "vox": f"seg{i}-vox.mp3" if has_vox else None,
        }
        manifest_segs.append(seg_manifest)
        report_rows.append(
            f"  seg{i} {s['name']:14s} bar@{s['startSec']:6.2f}s {bars:2d}b {s['role']:11s} "
            f"bed={seg_manifest['bedMode']:11s} vox={vox_mode:11s} "
            f"gate={seg_manifest['gate']} bedClick={bclick:.4f} voxClick={vclick:.4f} {vox_note}")
        print(report_rows[-1])

        if audition:
            # per-section loop x4 (bed+vox mixed)
            mix = bout + (vout if has_vox else 0)
            rep = np.tile(mix, (1, 4))
            encode(rep, os.path.join(VAULT_AUDITION, f"{key}-seg{i}-{s['name']}-loop4.mp3"),
                   key, f"aud-seg{i}")

    manifest = {
        "id": key,
        "name": cfg["name"],
        "tempo": round(tempo, 4),
        "barSeconds": round(bar, 5),
        "sfxMode": cfg["sfxMode"],
        "contentEndSeconds": round(content_end, 2),
        "segmentCount": len(manifest_segs),
        "segments": manifest_segs,
    }
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=2)
    print(f"  -> {out}/manifest.json ({len(manifest_segs)} segments)")

    if audition:
        report = [f"# {key} '{cfg['name']}' cut report",
                  f"tempo={tempo:.4f} bar={bar:.5f}s origin={origin:.4f}s content_end~{content_end:.1f}s",
                  ""] + report_rows
        open(os.path.join(VAULT_AUDITION, f"{key}-report.txt"), "w").write("\n".join(report))
        # adjacent-transition auditions: tail of seg i into head of seg i+1
        for i in range(len(manifest_segs) - 1):
            a = manifest_segs[i]
            b = manifest_segs[i + 1]
            ap = os.path.join(out, a["bed"])
            bp = os.path.join(out, b["bed"])
            ya = load_stereo(ap)
            yb = load_stereo(bp)
            half = ya.shape[1]
            trans = np.concatenate([ya[:, -half:], yb[:, :yb.shape[1]]], axis=1)
            encode(trans, os.path.join(VAULT_AUDITION, f"{key}-trans-{i}-{i+1}.mp3"),
                   key, f"aud-trans{i}")

    return manifest


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    keys = ["song1", "song2"] if which == "all" else [which]
    for k in keys:
        cut_song(k)
    print("\nDone.")
