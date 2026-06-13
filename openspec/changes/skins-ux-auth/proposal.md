# Proposal: skins-ux-auth

## Why

Three "skin" systems coexist (core SKINS at 120/144/168 BPM driving sweep speed + a host
NEON/PIPELINE bundle driving colours + soundtrack + the audio engine's songs at ~110/~126 BPM), so
the timeline bar is never in sync with the audible music — the defining Lumines coupling (audit
A6/D3) — and visual/musical progression advance on unrelated schedules. On top: restart resumes
the persisted skin instead of the base skin, a skin-toggle button/key exists that shouldn't, the
score is hidden, dead UI elements confuse, and Google sign-in is broken (audit C + Known Issues).

## What Changes

- **BREAKING: one skin system.** Delete the core `SKINS` list (`src/game/core/skins.ts`) and the
  per-20-squares `advanceSkin` progression. A skin is exactly the host bundle: colour world +
  soundtrack (+ its per-segment SFX). The ordered skin list IS the progression sequence.
- **Sweep speed = the playing song's BPM.** The controller's sweep BPM comes from the active
  audio track's manifest tempo (song1 ≈ 109.96, song2 ≈ 126.05), latched at pass boundaries as
  today. The bar is finally in sync with what the player hears. (One full pass = 16 eighth-notes
  = two bars of the actual song.)
- **Skin progression = song completion only.** The skin advances when the song completes
  (end-of-song switch, as the audio model already defines); no parallel squares-counter
  progression. Visual palette (`skinIndex`) and soundtrack can no longer disagree.
- **Restart → base skin.** Restarting (and starting a new game after game over) resets to the
  first skin; the localStorage persistence of the chosen skin is removed along with the toggle.
- **Remove the skin toggle** (HUD control + the N hotkey).
- **Score readout repositioned/styled so it is actually visible** during play.
- **Remove dead UI**: the unexplained bottom bar and the pointless "title" button.
- **Fix Google sign-in** (root-cause and repair the RealAccountProvider/Convex auth path; score
  submit on game over must work for signed-in users).

## Capabilities

### New Capabilities
- `skin-bundles`: the single skin definition (colours + soundtrack + SFX), the ordered
  progression, sweep-BPM-from-track coupling, end-of-song advancement, restart-to-base.
- `game-chrome`: HUD requirements — visible score, no skin toggle, no dead chrome; what controls
  exist and when.
- `account-auth`: Google sign-in flow, username selection, score submission on game over.

### Modified Capabilities
(none — no persistent specs exist yet)

## Impact

- Deletes/rewrites: `src/game/core/skins.ts` (+ its tests, `advanceSkin` in `sweep.ts`,
  `skinIndex`/`clearsInSkin` in GameState — coordinate with `core-lumines-fidelity`, which owns
  sweep.ts), `src/game/skins/useSkinSwitch.ts` (persistence + cycle), `src/game/skins/skins.ts`
  (gains tempo/identity as the single source), `controller.ts` (BPM source), `GameShell.tsx`
  (toggle removal, restart path, chrome cleanup), HUD components.
- Auth: `src/game/account/*` (RealAccountProvider), Convex config, env vars (`.env` /
  Cloudflare bindings) — root cause unknown going in; the spec defines the required behaviour.
- Merge order: depends on `core-lumines-fidelity` landing first for the sweep.ts/GameState
  conflict surface; audio coupling reads the manifest tempo the `audio-truth` engine already
  loads.
- Tests: skins/crossfade/useSkinSwitch suites rewritten; controller BPM tests re-pointed at
  track tempo; e2e production-start updated for chrome changes.
