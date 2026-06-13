> ⚠️ **SUPERSEDED / PARTIALLY STALE.** This plan captured an interim *autonomous-timeline* audio model that was **REJECTED**. The canonical design is **CLEAR-GATED** progression (the player's clears drive the song forward — see `README.md` → "Audio design"). Do NOT re-introduce an autonomous timeline. Kept only for build-history context.

# LLMines: FINE5 Audio Integration + Engine Rework — Implementation Plan

Goal: make the actual game play the **approved FINE5 audio model**, deploy to llmines.e8n.dev. Rai ear-approved the assets + model via the soundboard (`public/soundboard/progression.html`); this ports that model into the game engine.

## The model (approved, proven in the soundboard)
- **HORIZONTAL = autonomous musical timeline.** The song plays start→finish through its sections **in order, on its own clock**, NOT gated by clears. Each segment plays for its bar window, then advances to the next on a bar boundary. At the last segment → loop to start (or switch to the other song). Forward-only, but driven by the musical clock, not gameplay.
- **VERTICAL = gameplay-driven cumulative intensity.** A continuous `intensity` (0..N-1) is raised by clear events and **decays slowly** on a dry spell. The audible cumulative tier tracks intensity via bar-aligned equal-power crossfade. Clearing makes the song *fuller*, never moves its position.
- **Per-action SFX** (events.ts) unchanged — rotate/drop/clear fire one-shots.

## Current state to change
- `engine.ts` (1222 lines): `Tier = 0|1|2` hardcoded; `ManifestTiers = {tier0,tier1,tier2}`; `tierPlayers` length-3; **clear-gated advance** (`shouldAdvance`: "at tier2 AND segmentScore ≥ advanceThreshold") — REMOVE the position-gating; the A/B/C preset system (`setPreset`/`getPreset`/`curve()`).
- FINE5 assets: `public/audio/fine5/manifest.json` — song1 12 segs × 4 tiers, song2 10 segs × 5 tiers (cumulative). This becomes the live audio.
- Dead code: `presets.ts` (A/B/C mixes) + its UI in `SettingsBlock.tsx`, `overlays.tsx`, GameShell wiring; `scale.ts` (procedural pitch — verify unused after preset removal).
- Branch: `main` has all audio work; fold `feat/lumines-v2.8`'s 3 HUD commits (CRT-flicker fix) in. Work on `main`, no branches.

---

## Wave 1 — Engine core: N-tier + autonomous timeline + intensity
1. Generalize tiers: `Tier` number; `ManifestTiers` → ordered `tier0..tierN-1` (read count from manifest); `tierPlayers` dynamic length N. No hardcoded `>= 2` / length-3 assumptions.
2. HORIZONTAL autonomous advance: each segment plays its bar-window then advances to the next segment in order on the bar boundary, regardless of clears. Remove `shouldAdvance`/`segmentScore` *position* gating and the `transitionInFlight` clear-trigger. Keep the self-rescheduling loop-tick + symmetric crossfade for the segment hand-off. At last segment: loop to segment 0 (LOOPER/PROGRESSION) — for a TERMINAL final, ride out then loop or `switchTrack` to the other song (default: loop the same song; expose a hook).
3. VERTICAL intensity: add continuous `intensity` (0..N-1). `onScore(weight)` raises it (clamped); a per-bar decay lowers it on dry spells (slow). At each bar boundary, the armed tier = round(intensity) clamped to available; cumulative equal-power crossfade to it (reuse the existing swap logic, generalized to N). Energy-floor on fresh segment entry preserved but generalized.
4. SFX (events.ts) unchanged.
**Acceptance:** engine loads fine5 (4/5 tiers); `getAudioState()` exposes `{segmentIndex, intensity, tier, tierCount, trackId}`; song advances start→finish autonomously; clears raise intensity → higher cumulative tier; no clear ever changes segment position.

## Wave 2 — Integration + dead-code removal
1. Point `ASSET_BASE`/manifest at the FINE5 cut as the live audio (promote `fine5/` to the served manifest; preserve the prior 3-tier set as `_wave1_old/`). Update `makeTrack`/`resolveSong` if they assume a fixed path.
2. Remove the A/B/C preset system entirely: delete `presets.ts` + `presets.test.ts`; remove `setPreset`/`getPreset`/`curve()`/`AudioMix`/`AudioPreset` from `engine.ts`; remove the mix selector UI from `SettingsBlock.tsx`, `overlays.tsx`, and GameShell. Remove `scale.ts` + `scale.test.ts` **iff** nothing but the removed procedural-preset SFX used it (verify with grep first; keep if events/SFX still need it).
3. Update `GameShell.tsx` to the new engine API (drive `intensity` from clear events; no preset prop).
**Acceptance:** zero references to `AudioMix`/`Preset`/mix A/B/C in `src/`; no dead exports; UI has no mix selector; build has no unused-symbol errors.

### Wave 2 precise targets (recon, 2026-06-12)
- **`scale.ts` IS dead** — only `scale.test.ts` imports `./scale` (the render3d "scale" hits are CSS/3D transforms). Safe to delete `scale.ts` + `scale.test.ts`.
- **Preset removal is a REFACTOR, not a delete.** `presets.ts` mixes two concerns: (a) the A/B/C mix system (REMOVE), (b) the SFX action→sound routing (KEEP, preset-free). Split them:
  - REMOVE: `AudioMix`, `PRESETS`, `DEFAULT_MIX`, `asAudioMix`, `PresetCurve`, `UnlockCurve`, `AudioPreset`, the 3 mixes/curves; `setPreset`/`getPreset` from engine.ts; the mix-selector UI.
  - KEEP (move to a small preset-free module, e.g. `sfxRouting.ts`): `SfxName`, `VoiceRouting`, and a single fixed action→SFX map replacing `routeEvent(preset, ev)`. The engine's SFX fire path must keep working.
- **UI removal surface:** `GameShell.tsx` (lines ~15-18 imports, ~35 AUDIO_MIX_KEY, ~67-69 audioMix state, ~372 localStorage read, ~389 & ~413 `setPreset` calls, ~577 `onMixChange`); `hud/overlays.tsx` (lines 7, 34-35 AudioMix prop); `hud/SettingsBlock.tsx` (lines 9, 13 `MIXES=["A","B","C"]`, 29-30, 84 the "Audio mix preset" `<div role=group>` selector). Remove the selector entirely.
- **Manifest promotion:** swap served `/audio/manifest.json` → the fine5 cut (song1 4-tier / song2 5-tier). Preserve the old 3-tier `wave1-native-4layer` set as `_wave1_old/`. Engine is already tier-count-agnostic (Wave 1), so no engine change needed — just the asset/path swap + confirm `resolveSong`/`ASSET_BASE` point at it.

## Wave 3 — Tests + build green
1. Rewrite `engine.integration.test.ts` for the new model: assert autonomous advance (segment advances on the clock without clears), N-tier intensity crossfade (intensity up → higher tier, bar-aligned), forward-only position, song-end loop/switch, SFX pool unchanged. Delete `presets.test.ts` (and `scale.test.ts` if scale removed).
2. Gates green: `npx vitest run`; `npm run typecheck`; `npm run lint`; `npm run build`; `npm run test:e2e:production-start`.
**Acceptance:** all gates green; the production-start e2e audio probe shows `segmentIndex` advancing autonomously and `intensity` driving tiers.

## Post-wave (orchestrator, not a wave)
- Fold `feat/lumines-v2.8` HUD commits (`5fba74f` CRT-flicker) into `main`.
- Best-effort real-output verify: drive the built app under strict autoplay, confirm audio RMS > 0 + segment advances + intensity raises tiers (the soundboard already proves the assets; this proves the *engine integration*).
- Commit to `main`, push.
- Deploy: `npm run cf:deploy` → verify `https://llmines.e8n.dev` serves the new build (BLOCKED on CF creds — see Rai).

## Constraints
- Personal repo (rbutera/llmines): AI attribution OK, work on `main`, no branches.
- Reviewed-implementation: Opus + Codex review gate after each wave; fix loop until both pass before the next wave.
- Don't break the game: keep the existing game/render/HUD working; this is an audio-subsystem rework only.
