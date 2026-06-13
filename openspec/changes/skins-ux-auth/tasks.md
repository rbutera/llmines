# Tasks: skins-ux-auth

Merge AFTER `core-lumines-fidelity` (owns `sweep.ts` / `GameState`) and after/alongside `audio-truth` (provides engine `bpm` accessor + `onSongComplete`). Each wave ends green on the gates in Wave 6.

## 1. Wave 0 — Auth diagnostics (run first; root cause may be config-side)

- [x] 1.1 Probe the live deployment: query `https://llmines.e8n.dev/api/auth/providers`. Empty/`{}` ⇒ defect 1 (Google provider not registered = server env `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` unset in the Cloudflare Worker). DONE — see `notes-auth-diagnostic.md`: defect 1 RULED OUT (providers endpoint returns Google with correct origin-derived URLs).
- [x] 1.2 Attempt the Google sign-in flow on the live site; capture the redirect URI sent to Google and any callback error. A redirect-URI mismatch or host-derivation failure ⇒ defect 2 (`NEXTAUTH_URL`/`trustHost` + Google console redirect URI). DONE — host derivation works; the real defect is `OAuthSignin` thrown server-side (NextAuth v4 openid-client Google discovery over node http, unsupported at the Worker's `compatibility_date: 2025-05-05`).
- [x] 1.3 If sign-in completes, check whether a Convex call (e.g. `submitScore`) resolves an authenticated identity. Null identity ⇒ defect 3 (`CONVEX_AUTH_ISSUER_DOMAIN` unset → Convex trusts `https://example.com`). DEFERRED — cannot complete sign-in until the OAuthSignin defect is fixed; verify after.
- [x] 1.4 Record the confirmed defect set (1, 2, and/or 3) in the change notes; the Wave 5 fix set is the union of confirmed defects. Do NOT commit any secrets. DONE — recorded in `notes-auth-diagnostic.md`; fix = bump wrangler compat date (defect 2/3 config dead, defect 3 to verify post-sign-in).

## 2. Wave 1 — Core deletion + controller tempo seam (pure)

- [ ] 2.1 Delete `src/game/core/skins.ts` (the `Skin` type, `SKINS`, `skinAt`, `skinBpm`) and its test `src/game/core/skins.test.ts`.
- [ ] 2.2 Remove `export * from "./skins"` and the `skinBpm` import/use from `src/game/core/index.ts`.
- [ ] 2.3 Remove `SKIN_ADVANCE_THRESHOLD` from `src/game/core/constants.ts`.
- [ ] 2.4 In `src/game/core/sweep.ts` (post-`core-lumines-fidelity` shape): delete `advanceSkin` and every read/write of `skinIndex`/`clearsInSkin` in `advanceSweep` and `runFullSweep`.
- [ ] 2.5 In `src/game/core/types.ts`: remove `skinIndex` and `clearsInSkin` from `GameState`.
- [ ] 2.6 In `src/game/engine/controller.ts`: add `setTempo(bpm: number)` storing a pending tempo; change `currentSweepBpm()` to latch the pushed tempo at the pass boundary (sweepX === 0) with a `FALLBACK_BPM` default before the first push. Controller must NOT import the audio engine.
- [ ] 2.7 In `controller.ts`: change `RenderState.bpm` to the controller's current latched sweep tempo; remove the `skinBpm`/`skinIndex` reads. Remove `RenderState.skinIndex` (or repoint it) and the `testSetSkin`/`clearsInSkin`-related test helpers that referenced the deleted fields.

## 3. Wave 2 — Host skin = single source + tempo on the bundle

- [ ] 3.1 In `src/game/skins/skins.ts`: add a `tempo: number` field to the `Skin` interface; set `SKIN_NEON.tempo` = song1 manifest tempo (≈ 109.957) and `SKIN_PIPELINE.tempo` = song2 manifest tempo (≈ 126.05).
- [ ] 3.2 Add a guard test asserting each skin's `tempo` equals the manifest `tempo` for its `track.id` (single-source check).
- [ ] 3.3 Confirm `SKINS` ordering = progression order and `nextSkin` wraps (last → first); keep `DEFAULT_SKIN = SKINS[0]` as the base skin.

## 4. Wave 3 — Slim `useSkinSwitch` (programmatic only)

- [ ] 4.1 Remove `SKIN_STORAGE_KEY`, the mount-hydrate localStorage effect, and both `localStorage.setItem` calls (no persistence).
- [ ] 4.2 Rename `cycleSkin` → `advanceSkin` (advance to `nextSkin` with the colour + audio crossfade); used only by song completion.
- [ ] 4.3 Add `resetToBaseSkin()` that jumps to `SKINS[0]` instantly (no crossfade) for restart / new game.
- [ ] 4.4 Remove `setSkin` (it is a toggle by another name) and the `cycleSkin` export from `SkinSwitchState`.
- [ ] 4.5 Rewrite `src/game/skins/useSkinSwitch.test.*` (and adjust `crossfade.test.ts`/`skins.test.ts` as needed) to the new programmatic-only surface: advance-to-next crossfades, reset-to-base is instant, no persistence.

## 5. Wave 4 — GameShell wiring + chrome cleanup

- [ ] 5.1 Wire the tempo seam: in `handleStart` and `handleRestart`, call `controller.setTempo(skinSwitch.skin.tempo)` before `controller.start()`; on skin advance, call `controller.setTempo(nextSkin.tempo)` so the controller latches it at the next wrap.
- [ ] 5.2 Point `engine.onSongComplete` at `skinSwitch.advanceSkin()` (renamed); keep the live-ref pattern so it never closes over a stale skin.
- [ ] 5.3 Restart-to-base: `handleRestart` and the post-game-over new-game path call `resetToBaseSkin()`; `handleStart` sets the initial track to `SKINS[0].track`.
- [ ] 5.4 Remove the N-key skin hotkey `useEffect` (GameShell lines ~240-258) and drop "n skin" from `ControlsContract` + the `Cheatsheet` atom.
- [ ] 5.5 Remove the skin-cycle button + `onCycleSkin` prop from `StartView`; remove the skin selector from `PauseOverlay`/`SettingsBlock` (`skinId`/`onSelectSkin` props).
- [ ] 5.6 Score legibility: lift the in-play score out of the `.recede` (dimmed) wrapper and give it a legible treatment (backing chip / stronger contrast), keep it top-left, keep `data-testid="score"`.
- [ ] 5.7 Remove the dead bottom decorative bar (the redundant bottom `tickrail` + duplicate bottom pause-hint) in `PlayHud`; keep the timeline-sweep caret (real `sweepX`).
- [ ] 5.8 Remove the "TITLE" button from `GameOverView` and the `onTitle`/`goToTitle` handler from GameShell; game over keeps PLAY AGAIN + RANKS.
- [ ] 5.9 Verify exactly one `<main>` landmark (the `.screen` root) and that all remaining controls are keyboard-reachable buttons.

## 6. Wave 5 — Auth fix (code + deploy config; per confirmed defects)

- [ ] 6.1 Set `trustHost: true` in `authOptions` (`src/server/auth.ts`) so origin derivation works behind the Cloudflare/OpenNext proxy.
- [ ] 6.2 If the diagnostic shows host/redirect issues: plumb `NEXTAUTH_URL` into `src/env.js` runtime env and ensure NextAuth reads it; confirm the OpenNext Worker resolves server env at request time (add any required runtime declaration / `getCloudflareContext` env shim only if the diagnostic shows it is needed).
- [ ] 6.3 Deploy config (not committed): set Worker secrets/vars `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CONVEX_AUTH_ISSUER_DOMAIN`, `CONVEX_AUTH_APPLICATION_ID`, and client var `NEXT_PUBLIC_CONVEX_URL` on the Cloudflare deployment.
- [ ] 6.4 Register `https://llmines.e8n.dev/api/auth/callback/google` as an authorized redirect URI in the Google OAuth client (external console step — flag for Rai).
- [ ] 6.5 Set `CONVEX_AUTH_ISSUER_DOMAIN` to the deployed origin and configure the Convex deployment to trust it (so `ctx.auth.getUserIdentity()` is populated).
- [ ] 6.6 Live verification on `llmines.e8n.dev`: sign in with Google succeeds, username select shows for a new user, and a signed-in game over submits a score the backend accepts (manual gate, like the audio ear-check).

## 7. Wave 6 — Tests + gates

- [ ] 7.1 Re-point controller BPM tests at the track-tempo seam: assert the sweep speed follows `setTempo`, latched at the pass boundary (no mid-pass jump); update `controller.test.ts` / `controller.v2.test.ts` for the removed `skinIndex`/`skinBpm`.
- [ ] 7.2 Update the e2e `e2e/production-start.spec.ts` (and `lumines.spec.ts` where it touches chrome) for: no skin toggle, no N key, no bottom bar, no title button, legible score; preserve the `score`/`start-button`/`restart`/`game-over`/`controls-cheatsheet` contracts.
- [ ] 7.3 Add an e2e/unit assertion that song completion advances the skin and clears do not, and that restart resets to the base skin.
- [ ] 7.4 Run gates green: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test:e2e:production-start` · `node scripts/repro-autoplay.mjs <baseURL>` (strict-autoplay must stay green).
- [ ] 7.5 Deploy via `pnpm cf:deploy`; confirm the live site plays (sweep in time with the music), skins advance on song completion, and sign-in + score submit work.
