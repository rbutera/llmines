# LLMines Audio Asset Regen — FINE6 Validation Report

Generated 2026-06-13 03:50 BST. Two fixes on top of the EAR-APPROVED FINE5 cut,
fully staged + reversible (new build dirs, the approved fine5 outputs untouched):

- **B6** — top tier (full reveal) is now cut from the full-mix MASTER, level-matched to
  the stem-sum top tier it replaces so the tier(N-2)->tier(N-1) crossfade seam holds.
- **B5** — per-segment SFX: each segment gets rotate/softdrop/drop/stage cut from its own
  stems (move stays silent by design), song-level fallback so every segment always has all four.

Lower tiers (tier0..N-2) are byte-identical to FINE5 (the additive single-gain bed mechanic
is untouched), so the approved bed/build-up sound does not change.

## Headline

- **Status: DONE.** All objective gates pass.
- **Master-tier (B6) check:** 22/22 PASS, max LUFS delta vs level-matched master = **0.000 LU**, **0 fallbacks** (every top tier IS the master content).
- **Seam check (rendered master top vs old stem-sum top):** worst = **0.010 LU** (no audible crossfade jump).
- **Loop seams (B6 LOOPER tiers incl. new master top):** ALL PASS (whole-bar + join buried under interior program).
- **Per-segment SFX:** 88 emitted (22 segments x 4 types), 87 from-segment, **1 fallback**, **0 silent**. Lowest opus peak -6.3 dBFS (target ~-6).
- **Total served:** 196 opus files, 25.21 MB (98 tiers + 88 per-seg sfx + 10 song-level sfx).

## Staging dir (ready for orchestrator)

`build-fine6/public-audio/` — copy its CONTENTS into `/Users/rai/dev/llmines/public/audio/`.
Manifest version bumped `fine5-native-cumulative` -> `fine6-master-perseg-sfx`.
Field names match engine.ts (ManifestSegment.tiers / .sfx, ManifestSfx{move,rotate,softdrop,drop,stage}, segmentSfxUrlFor falls back per-name to song-level).

## B6 — top tier LUFS (per segment)

oldTopLUFS = the FINE5 stem-sum top tier that was replaced; newTopLUFS = the rendered
master-slice top tier (level-matched). seam dLU = newTop - oldTop (the crossfade-jump test).
masterLMdB = the level-match gain applied to the raw master slice; guardDB = peak guard
(0.00 everywhere = no clip).

| song | segment | tier | oldTopLUFS | newTopLUFS | seam dLU | masterLMdB | guardDB |
|---|---|---|---|---|---|---|---|
| song1 | s1-intro | tier3 | -17.03 | -17.03 | +0.00 | -1.99 | +0.00 |
| song1 | s1-verse1 | tier3 | -14.89 | -14.89 | +0.00 | -0.19 | +0.00 |
| song1 | s1-build | tier3 | -12.01 | -12.01 | +0.00 | +2.00 | +0.00 |
| song1 | s1-chorus | tier3 | -12.53 | -12.53 | +0.00 | +1.14 | +0.00 |
| song1 | s1-break | tier3 | -12.85 | -12.85 | +0.00 | +0.70 | +0.00 |
| song1 | s1-verse2 | tier3 | -14.67 | -14.68 | -0.01 | -0.83 | +0.00 |
| song1 | s1-build2 | tier3 | -13.80 | -13.80 | +0.00 | +1.16 | +0.00 |
| song1 | s1-chorus2 | tier3 | -16.45 | -16.45 | +0.00 | -2.09 | +0.00 |
| song1 | s1-bridge | tier3 | -13.05 | -13.05 | +0.00 | +1.12 | +0.00 |
| song1 | s1-beatdrop | tier3 | -15.45 | -15.44 | +0.01 | -1.27 | +0.00 |
| song1 | s1-chorus3 | tier3 | -13.94 | -13.94 | +0.00 | +0.17 | +0.00 |
| song1 | s1-outro | tier3 | -11.99 | -11.99 | +0.00 | +2.33 | +0.00 |
| song2 | s2-intro | tier4 | -15.52 | -15.51 | +0.01 | -0.39 | +0.00 |
| song2 | s2-verse1 | tier4 | -13.87 | -13.87 | +0.00 | +1.40 | +0.00 |
| song2 | s2-build | tier4 | -12.63 | -12.63 | +0.00 | +1.39 | +0.00 |
| song2 | s2-bridge1 | tier4 | -12.12 | -12.12 | +0.00 | +1.26 | +0.00 |
| song2 | s2-verse2 | tier4 | -13.61 | -13.61 | +0.00 | +0.50 | +0.00 |
| song2 | s2-build2 | tier4 | -11.31 | -11.30 | +0.01 | +1.81 | +0.00 |
| song2 | s2-break | tier4 | -11.71 | -11.71 | +0.00 | +1.14 | +0.00 |
| song2 | s2-chorus3 | tier4 | -12.72 | -12.72 | +0.00 | +0.61 | +0.00 |
| song2 | s2-outro1 | tier4 | -12.04 | -12.04 | +0.00 | -0.03 | +0.00 |
| song2 | s2-outro | tier4 | -13.53 | -13.53 | +0.00 | -1.57 | +0.00 |

Master-tier validator (rendered top vs level-matched master slice): 22/22 within +/-1.0 LU, all dLU = 0.000.

## B5 — per-segment SFX peak (dBFS, * = fell back to song-level)

| song | segment | rotate | softdrop | drop | stage |
|---|---|---|---|---|---|
| song1 | s1-intro | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-verse1 | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-build | -2dB | -2dB | -2dB | -5dB |
| song1 | s1-chorus | -3dB | -2dB | -2dB | -2dB |
| song1 | s1-break | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-verse2 | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-build2 | -2dB* | -2dB | -2dB | -6dB |
| song1 | s1-chorus2 | -2dB | -2dB | -1dB | -2dB |
| song1 | s1-bridge | -2dB | -2dB | -1dB | -4dB |
| song1 | s1-beatdrop | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-chorus3 | -2dB | -2dB | -2dB | -2dB |
| song1 | s1-outro | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-intro | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-verse1 | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-build | -2dB | -2dB | -2dB | -4dB |
| song2 | s2-bridge1 | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-verse2 | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-build2 | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-break | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-chorus3 | -2dB | -1dB | -2dB | -2dB |
| song2 | s2-outro1 | -2dB | -2dB | -2dB | -2dB |
| song2 | s2-outro | -2dB | -2dB | -2dB | -2dB |

Fallbacks used: **song1/s1-build2/rotate** (1 of 88) — that segment yielded no clean bright
transient above the silent floor, so it reuses song1's song-level rotate. Every other
one-shot is cut from its own segment. All 98 sfx opus (88 per-seg + 10 song-level) decode
non-silent (peak > -40 dBFS).

## Objective gates (all PASS)

1. validate-master-tier-fine.py: 22/22 within +/-1.0 LU (exit 0). PASS.
2. check-loops-fine.py: all FINE6 LOOPER tiers whole-bar + clean seam (exit 0). PASS.
3. Per-segment sfx non-silent: 88/88 wav + 98/98 opus peak > -40 dBFS. PASS.
4. Manifest: every segment has tier0..N AND sfx{rotate,softdrop,drop,stage}; song-level sfx present (incl. move); 196/196 opus exist + non-zero. PASS.
5. Tier counts + segment ids/types/bars IDENTICAL to deployed manifest (song1 12x4, song2 10x5). PASS.

## Verified objectively vs needs Rai's ear

**Objectively verified (numbers):** top tier == master content (dLU 0.0), seam holds (0.01 LU),
loop seams clean, all sfx non-silent at target level, manifest structurally correct + engine-shaped,
cut geometry unchanged from the approved fine5.

**Needs Rai's ear (perceptual, can't be auto-gated):**
- Whether the master-cut full-reveal "reads" as the song the way the stem-sum did (it's the
  same finished mix at matched loudness, so it should sound MORE like the record, not less —
  but it's a different source per the no-hiss bed: lower tiers are stems, the top is the master).
- Whether each segment's chosen per-segment one-shots FEEL right for the action (the onset
  picker is heuristic; e.g. a chorus stage = a vocal-adjacent stab, a beat-drop stage = a kick).

## Fallbacks / caveats

- 1 sfx fallback (song1/s1-build2/rotate) — cosmetic, still a valid bright tick from the song.
- 0 master-tier fallbacks — every top tier cut from the master.
- No peak-guard fired on any master top tier (level-match was clean), so no clamp-induced drift.
