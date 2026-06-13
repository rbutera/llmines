#!/usr/bin/env python3
"""
FINE6 Opus transcode + manifest emit (B5 + B6), fully staged + non-destructive.

SAFETY: writes ONLY to build-fine6/public-audio/ under the audio-build staging tree.
Never touches the live game's public/audio/. The orchestrator copies the staging dir
into /Users/rai/dev/llmines/public/audio/.

1. Transcodes every FINE6 tier WAV (build-fine6/wav/<song>/<seg>-tier{0..N}.wav —
   top tier = master slice) AND every per-segment + song-level SFX WAV
   (build-fine6/sfx/...) to Opus, SAME codec settings as the current pipeline
   (libopus, 112 kbps VBR, application=audio).
2. Verifies each Opus decodes (ffprobe) + records size.
3. Emits manifest.json in the SAME structure as the deployed manifest, PLUS
   `segments[].sfx` on every segment (the per-segment palette: rotate/softdrop/
   drop/stage — `move` is intentionally absent, silent-by-design, and resolves to
   the song-level fallback), KEEPING the song-level `sfx` (incl. move) as fallback.
   Field names match engine.ts ManifestSegment / ManifestSfx / segmentSfxUrlFor
   exactly. `version` bumped to fine6-master-perseg-sfx.

Run: .venv-audio/bin/python scripts/audio/transcode-and-manifest-fine-v2.py
"""
import json
import os
import subprocess
import soundfile as sf

ROOT = os.path.expanduser("~/dev/llmines-audio-build")
BUILD_WAV = os.path.join(ROOT, "build-fine6", "wav")
SFX_WAV = os.path.join(ROOT, "build-fine6", "sfx")
REPORTS = os.path.join(ROOT, "build-reports")
PLAN_PATH = os.path.join(ROOT, "scripts", "audio", "cut-plan-fine.json")
RENDER_REPORT = os.path.join(REPORTS, "render-report-fine6.json")
SFX_REPORT = os.path.join(REPORTS, "sfx-fine6-report.json")
TRANSCODE_REPORT = os.path.join(REPORTS, "transcode-report-fine6.json")

# Staging output — the orchestrator copies this into the game's public/audio/.
PUB = os.path.join(ROOT, "build-fine6", "public-audio")

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
OPUS_KBPS = "112"

PLAN = json.load(open(PLAN_PATH))
SFX_TYPES = ("rotate", "softdrop", "drop", "stage")  # per-segment (move = silent)
SONGLEVEL_TYPES = ("move", "rotate", "softdrop", "drop", "stage")


def load_render_report():
    bw, tn = {}, {}
    try:
        rep = json.load(open(RENDER_REPORT))
        for song, sd in rep.get("songs", {}).items():
            tn[song] = sd.get("tierNames", [])
            for s in sd.get("segments", []):
                bw[(song, s["id"])] = s.get("barWindowSec")
    except (OSError, ValueError, KeyError):
        pass
    return bw, tn


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


def emit_opus(in_wav, rel, report, ledger):
    """Transcode in_wav -> PUB/rel, verify, record. Returns rel."""
    out = os.path.join(PUB, rel)
    transcode(in_wav, out)
    ok, dur = probe_ok(out)
    size = os.path.getsize(out)
    ledger["bytes"] += size
    if not ok or size == 0:
        ledger["decodeFail"].append(rel)
    report.append({"file": rel, "bytes": size, "opusDur": round(dur, 3),
                   "decodeOk": ok})
    return rel


def main():
    bar_windows, tier_names_by_song = load_render_report()
    sfx_rep = json.load(open(SFX_REPORT))

    manifest = {"version": "fine6-master-perseg-sfx", "songs": []}
    files = []
    ledger = {"bytes": 0, "decodeFail": []}
    missing = []

    for song in ("song1", "song2"):
        sp = PLAN[song]
        tier_names = tier_names_by_song.get(song, [])
        song_entry = {
            "id": song,
            "title": sp["title"],
            "tempo": sp["bpm"],
            # Per-song musical key for the in-key tone SFX (engine design D6). Sourced
            # from the plan; defaults to A minor (song1's character) if the plan omits
            # it. song1 = A minor, song2 (phonk) = F# minor.
            "key": sp.get("key", {"root": "A", "scale": "minor"}),
            "barSeconds": round(sp["secPerBar"], 6),
            "segments": [],
        }
        song_sfx_rep = sfx_rep["songs"][song]

        for seg in sp["segments"]:
            bars = seg["endBar"] - seg["startBar"] + 1
            names = tier_names
            if not names:
                segdir = os.path.join(BUILD_WAV, song)
                found = sorted(f for f in os.listdir(segdir)
                               if f.startswith(f"{seg['id']}-tier")
                               and f.endswith(".wav"))
                names = [f[len(seg["id"]) + 1:-len(".wav")] for f in found]

            tiers = {}
            length_s = None
            for tier in names:
                wav = os.path.join(BUILD_WAV, song, f"{seg['id']}-{tier}.wav")
                if not os.path.exists(wav):
                    missing.append(f"{song}/{seg['id']}-{tier}.wav")
                    continue
                rel = emit_opus(wav, f"{song}/{seg['id']}-{tier}.opus", files, ledger)
                tiers[tier] = rel
                if length_s is None:
                    length_s = wav_seconds(wav)

            # per-segment SFX (rotate/softdrop/drop/stage) — `move` omitted on purpose.
            seg_sfx = {}
            seg_sfx_rep = song_sfx_rep["segments"][seg["id"]]
            for t in SFX_TYPES:
                wav = seg_sfx_rep[t]["wav"]
                if not os.path.exists(wav):
                    missing.append(wav)
                    continue
                rel = emit_opus(wav, f"sfx/{song}/{seg['id']}/sfx-{t}.opus",
                                files, ledger)
                seg_sfx[t] = rel

            bar_window = bar_windows.get((song, seg["id"]))
            if bar_window is None:
                bar_window = round(sp["secPerBar"] * bars, 4)
            song_entry["segments"].append({
                "id": seg["id"],
                "type": seg["type"],
                "bars": bars,
                "lengthSeconds": length_s,
                "barWindowSeconds": bar_window,
                "character": seg["character"],
                "tiers": tiers,
                "sfx": seg_sfx,
            })

        # song-level SFX fallback (incl. move): cut from build-fine6/sfx/<song>/_songlevel
        # for rotate/softdrop/drop/stage; `move` reuses the existing live song-level
        # move slice if present (move is silent-routed, never actually played, but the
        # manifest keeps the key for byte-compatible fallback shape).
        song_sfx = {}
        sl = song_sfx_rep["songLevel"]
        for t in ("rotate", "softdrop", "drop", "stage"):
            wav = sl[t]["wav"]
            if os.path.exists(wav):
                rel = emit_opus(wav, f"sfx/{song}/songlevel/sfx-{t}.opus",
                                files, ledger)
                song_sfx[t] = rel
        # `move`: carry forward the deployed live move slice so the fallback set is
        # complete (move is silent-routed; this is purely shape-completeness).
        live_move = f"/Users/rai/dev/llmines/public/audio/{song}/sfx-move.opus"
        if os.path.exists(live_move):
            rel = f"sfx/{song}/songlevel/sfx-move.opus"
            out = os.path.join(PUB, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            subprocess.run([FFMPEG, "-y", "-v", "error", "-i", live_move,
                            "-c:a", "libopus", "-b:a", f"{OPUS_KBPS}k", "-vbr", "on",
                            "-application", "audio", out], check=True)
            ok, dur = probe_ok(out)
            ledger["bytes"] += os.path.getsize(out)
            files.append({"file": rel, "bytes": os.path.getsize(out),
                          "opusDur": round(dur, 3), "decodeOk": ok})
            song_sfx["move"] = rel
        song_entry["sfx"] = song_sfx
        manifest["songs"].append(song_entry)

    os.makedirs(PUB, exist_ok=True)
    json.dump(manifest, open(os.path.join(PUB, "manifest.json"), "w"), indent=2)

    report = {
        "files": files,
        "totalBytes": ledger["bytes"],
        "totalMB": round(ledger["bytes"] / 1024 / 1024, 2),
        "fileCount": len(files),
        "decodeFailures": ledger["decodeFail"],
        "missingWavs": missing,
    }
    json.dump(report, open(TRANSCODE_REPORT, "w"), indent=2)

    print(f"\nTotal served audio: {report['totalMB']} MB across {len(files)} opus files")
    print(f"Decode failures: {ledger['decodeFail'] if ledger['decodeFail'] else 'none'}")
    print(f"Missing WAVs: {missing if missing else 'none'}")
    print(f"manifest -> {os.path.join(PUB, 'manifest.json')}")


if __name__ == "__main__":
    main()
