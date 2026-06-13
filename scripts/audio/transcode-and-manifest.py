#!/usr/bin/env python3
"""
Opus transcode + manifest emit for the LLMines audio redesign (Wave 1 final step).

1. Moves the old v2.7 mp3 set (seg*-bed/vox, sfx-*) out of public/audio/ into
   public/audio/_v27_old/ as a fallback (only on first run).
2. Transcodes every rendered tier WAV (build/wav/<song>/<seg>-tier{0,1,2}.wav)
   and every SFX WAV (build/wav/sfx/<song>/sfx-*.wav) to Opus ~112 kbps VBR
   (libopus) into public/audio/<song>/.
3. Verifies each Opus file decodes (ffprobe) and records its size.
4. Emits public/audio/manifest.json: per song { id, title, tempo, barSeconds,
   segments:[{id,type,bars,lengthSeconds,barWindowSeconds,character,
   tiers:{tier0,tier1,...},sfx?}], sfx:{action->path} }.

   PER-SEGMENT SFX (task 8.2): when a segment has a per-segment palette under
   build/wav/sfx/<song>/<segid>/, those one-shots are transcoded into
   public/audio/<song>/<segid>/ and emitted as `segments[].sfx` (same shape as the
   song-level `sfx`). The song-level `sfx` is ALWAYS still emitted as the fallback,
   so a segment with no per-segment cut (or only a partial one) resolves to the
   song level in the engine. The manifest `version` is bumped so a stale cache is
   invalidated.

   barWindowSeconds = the SPILL-FREE whole-bar loop length (barSeconds * bars),
   sourced from render-report.json's barWindowSec. lengthSeconds is the full file
   duration (includes the play-through spill tail for PROGRESSION/TERMINAL). The
   engine loops on barWindowSeconds (loopEnd) so the loop tick and the audio wrap
   agree; lengthSeconds is kept for reporting / total-size math only.

Run: .venv-audio/bin/python scripts/audio/transcode-and-manifest.py
"""
import json
import os
import shutil
import subprocess
import numpy as np
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
BUILD_WAV = os.path.join(ROOT, "build", "wav")
PUB = os.path.join(ROOT, "public", "audio")
REPORTS = os.path.join(ROOT, "build-reports")
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
OPUS_KBPS = "112"

PLAN = json.load(open(os.path.join(ROOT, "scripts", "audio", "cut-plan.json")))


def load_bar_windows():
    """Map (song, segId) -> barWindowSec from the render report (spill-free loop len)."""
    rep_path = os.path.join(REPORTS, "render-report.json")
    out = {}
    try:
        rep = json.load(open(rep_path))
        for song, sd in rep.get("songs", {}).items():
            for s in sd.get("segments", []):
                out[(song, s["id"])] = s.get("barWindowSec")
    except (OSError, ValueError, KeyError):
        pass
    return out


def archive_v27():
    old = os.path.join(PUB, "_v27_old")
    if os.path.exists(old):
        return  # already archived
    os.makedirs(old, exist_ok=True)
    moved = []
    for f in os.listdir(PUB):
        p = os.path.join(PUB, f)
        if os.path.isfile(p) and (f.startswith("seg") or f.startswith("sfx-")
                                  or f == "manifest.json"):
            shutil.move(p, os.path.join(old, f))
            moved.append(f)
    # the old song2/ subdir (v2.7) -> archive too
    old_song2 = os.path.join(PUB, "song2")
    if os.path.isdir(old_song2) and not os.path.exists(os.path.join(old, "song2")):
        # only archive if it looks like v2.7 (contains seg*/sfx mp3s, not our tiers)
        contents = os.listdir(old_song2)
        if any(c.startswith("seg") or c.endswith(".mp3") for c in contents):
            shutil.move(old_song2, os.path.join(old, "song2"))
            moved.append("song2/")
    print(f"  archived {len(moved)} v2.7 files -> _v27_old/")


def transcode(in_wav, out_opus):
    os.makedirs(os.path.dirname(out_opus), exist_ok=True)
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", in_wav,
                    "-c:a", "libopus", "-b:a", f"{OPUS_KBPS}k", "-vbr", "on",
                    "-application", "audio", out_opus], check=True)


def probe_ok(path):
    p = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                        "stream=codec_name,duration", "-of", "json", path],
                       capture_output=True, text=True)
    try:
        j = json.loads(p.stdout)
        s = j["streams"][0]
        return s.get("codec_name") == "opus", float(s.get("duration", 0))
    except Exception:  # noqa: BLE001
        return False, 0.0


def wav_seconds(path):
    info = sf.info(path)
    return round(info.frames / info.samplerate, 4)


def discover_tier_keys(song, seg_id):
    """The ordered tier keys (`tier0`, `tier1`, ...) rendered for a segment, by
    scanning build/wav/<song>/ for `<seg>-tierN.wav`. EXCLUDES the `-stemsum` revert
    copies render-tiers.py preserves for the master-top swap. Falls back to the legacy
    fixed 3-tier set if the dir is unreadable (keeps the script runnable in either
    pipeline)."""
    d = os.path.join(BUILD_WAV, song)
    import re
    pat = re.compile(rf"^{re.escape(seg_id)}-tier(\d+)\.wav$")
    found = []
    try:
        for f in os.listdir(d):
            m = pat.match(f)  # `<seg>-tierN.wav` only (stemsum has a -stemsum suffix)
            if m:
                found.append(int(m.group(1)))
    except OSError:
        pass
    if not found:
        return ["tier0", "tier1", "tier2"]  # legacy fallback
    return [f"tier{i}" for i in sorted(found)]


def transcode_sfx_dir(song, sfxdir, rel_prefix, report, decode_fail):
    """Transcode every sfx-<name>.wav in a dir to <rel_prefix>/sfx-<name>.opus and
    return ({name -> rel}, totalBytes). Used for both the song-level set and the
    per-segment palettes. Subdirectories (per-segment folders inside the song-level
    dir) are skipped — only `sfx-*.wav` files are transcoded."""
    out_map = {}
    if not os.path.isdir(sfxdir):
        return out_map, 0
    total = 0
    for f in sorted(os.listdir(sfxdir)):
        if not f.endswith(".wav") or not f.startswith("sfx-"):
            continue
        name = f[len("sfx-"):-len(".wav")]
        rel = f"{rel_prefix}/sfx-{name}.opus"
        out = os.path.join(PUB, rel)
        transcode(os.path.join(sfxdir, f), out)
        ok, dur = probe_ok(out)
        size = os.path.getsize(out)
        total += size
        if not ok:
            decode_fail.append(rel)
        report["files"].append({"file": rel, "bytes": size, "opusDur": round(dur, 3),
                                "decodeOk": ok})
        out_map[name] = rel
    return out_map, total


def main():
    print("Archiving v2.7 assets...")
    archive_v27()

    # version bumped for the audio-truth top-tier-master + per-segment-sfx assets so
    # a stale `force-cache` manifest/tier set is invalidated on deploy.
    manifest = {"version": "audio-truth-master-top-segsfx", "songs": []}
    total_bytes = 0
    decode_fail = []
    report = {"files": [], "totalBytes": 0}
    bar_windows = load_bar_windows()

    for song in ("song1", "song2"):
        sp = PLAN[song]
        beat_bars = sp["secPerBar"]
        song_entry = {
            "id": song,
            "title": sp["title"],
            "tempo": sp["bpm"],
            "barSeconds": round(sp["secPerBar"], 6),
            "segments": [],
            "sfx": {},
        }
        # segment tiers (N-tier, master-top + stem-sum revert copies excluded)
        for seg in sp["segments"]:
            bars = seg["endBar"] - seg["startBar"] + 1
            tiers = {}
            length_s = None
            for tier in discover_tier_keys(song, seg["id"]):
                wav = os.path.join(BUILD_WAV, song, f"{seg['id']}-{tier}.wav")
                if not os.path.exists(wav):
                    continue
                rel = f"{song}/{seg['id']}-{tier}.opus"
                out = os.path.join(PUB, rel)
                transcode(wav, out)
                ok, dur = probe_ok(out)
                size = os.path.getsize(out)
                total_bytes += size
                if not ok:
                    decode_fail.append(rel)
                report["files"].append({"file": rel, "bytes": size, "opusDur": round(dur, 3),
                                        "decodeOk": ok})
                tiers[tier] = rel
                if length_s is None:
                    length_s = wav_seconds(wav)
            # spill-free whole-bar loop length: prefer the render report, else the
            # exact bar math (barSeconds * bars). This is what the engine loops on.
            bar_window = bar_windows.get((song, seg["id"]))
            if bar_window is None:
                bar_window = round(sp["secPerBar"] * bars, 4)
            seg_entry = {
                "id": seg["id"],
                "type": seg["type"],
                "bars": bars,
                "lengthSeconds": length_s,
                "barWindowSeconds": bar_window,
                "character": seg["character"],
                "tiers": tiers,
            }
            # PER-SEGMENT SFX (task 8.2): transcode this segment's own palette (if any)
            # and emit `segments[].sfx`. Omitted when there is no per-segment cut, so
            # the engine resolves those actions to the song-level fallback.
            seg_sfx_dir = os.path.join(BUILD_WAV, "sfx", song, seg["id"])
            seg_sfx, seg_bytes = transcode_sfx_dir(
                song, seg_sfx_dir, f"{song}/{seg['id']}", report, decode_fail
            )
            total_bytes += seg_bytes
            if seg_sfx:
                seg_entry["sfx"] = seg_sfx
            song_entry["segments"].append(seg_entry)
        # song-level sfx (ALWAYS emitted — the per-segment fallback)
        song_sfx, song_sfx_bytes = transcode_sfx_dir(
            song, os.path.join(BUILD_WAV, "sfx", song), song, report, decode_fail
        )
        total_bytes += song_sfx_bytes
        song_entry["sfx"] = song_sfx
        manifest["songs"].append(song_entry)

    os.makedirs(PUB, exist_ok=True)
    json.dump(manifest, open(os.path.join(PUB, "manifest.json"), "w"), indent=2)

    report["totalBytes"] = total_bytes
    report["totalMB"] = round(total_bytes / 1024 / 1024, 2)
    report["decodeFailures"] = decode_fail
    json.dump(report, open(os.path.join(REPORTS, "transcode-report.json"), "w"), indent=2)

    print(f"\nTotal served audio: {report['totalMB']} MB across {len(report['files'])} opus files")
    print(f"Decode failures: {decode_fail if decode_fail else 'none'}")
    print("manifest.json + transcode-report.json written")


if __name__ == "__main__":
    main()
