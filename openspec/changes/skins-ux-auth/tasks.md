# Tasks: skins-ux-auth

Merge AFTER `core-lumines-fidelity` (owns `sweep.ts` / `GameState`) and after/alongside `audio-truth` (provides engine `bpm` accessor + `onSongComplete`). Each wave ends green on the gates in Wave 6.

## 1. Wave 0 — Auth diagnostics (run first; root cause may be config-side)

- [x] 1.1 Probe the live deployment: query `https://llmines.e8n.dev/api/auth/providers`. Empty/`{}` ⇒ defect 1 (Google provider not registered = server env `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` unset in the Cloudflare Worker). DONE — see `notes-auth-diagnostic.md`: defect 1 RULED OUT (providers endpoint returns Google with correct origin-derived URLs).
- [x] 1.2 Attempt the Google sign-in flow on the live site; capture the redirect URI sent to Google and any callback error. A redirect-URI mismatch or host-derivation failure ⇒ defect 2 (`NEXTAUTH_URL`/`trustHost` + Google console redirect URI). DONE — host derivation works; the real defect is `OAuthSignin` thrown server-side (NextAuth v4 openid-client Google discovery over node http, unsupported at the Worker's `compatibility_date: 2025-05-05`).
- [x] 1.3 If sign-in completes, check whether a Convex call (e.g. `submitScore`) resolves an authenticated identity. Null identity ⇒ defect 3 (`CONVEX_AUTH_ISSUER_DOMAIN` unset → Convex trusts `https://example.com`). DEFERRED — cannot complete sign-in until the OAuthSignin defect is fixed; verify after.
- [x] 1.4 Record the confirmed defect set (1, 2, and/or 3) in the change notes; the Wave 5 fix set is the union of confirmed defects. Do NOT commit any secrets. DONE — recorded in `notes-auth-diagnostic.md`; fix = bump wrangler compat date (defect 2/3 config dead, defect 3 to verify post-sign-in).

## 2. Wave 1 — Core deletion + controller tempo seam (pure)

- [x] 2.1 Delete `src/game/core/skins.ts` (the `Skin` type, `SKINS`, `skinAt`, `skinBpm`) and its test `src/game/core/skins.test.ts`.
- [x] 2.2 Remove `export * from "./skins"` and the `skinBpm` import/use from `src/game/core/index.ts`.
- [x] 2.3 Remove `SKIN_ADVANCE_THRESHOLD` from `src/game/core/constants.ts`.
- [x] 2.4 In `src/game/core/sweep.ts` (post-`core-lumines-fidelity` shape): delete `advanceSkin` and every read/write of `skinIndex`/`clearsInSkin` in `advanceSweep` and `runFullSweep`.
- [x] 2.5 In `src/game/core/types.ts`: remove `skinIndex` and `clearsInSkin` from `GameState`.
- [x] 2.6 In `src/game/engine/controller.ts`: add `setTempo(bpm: number)` storing a pending tempo; change `currentSweepBpm()` to latch the pushed tempo at the pass boundary (sweepX === 0) with a `FALLBACK_BPM` default before the first push. Controller must NOT import the audio engine.
- [x] 2.7 In `controller.ts`: change `RenderState.bpm` to the controller's current latched sweep tempo; remove the `skinBpm`/`skinIndex` reads. Repoint `RenderState.skinIndex` to a host-pushed `setSkinIndex(n)` seam (render-only); `testSetSkin` → `testSetTempo`; test-api `setSkin` → `setTempo`.

## 3. Wave 2 — Host skin = single source + tempo on the bundle

- [x] 3.1 In `src/game/skins/skins.ts`: add a `tempo: number` field to the `Skin` interface; set `SKIN_NEON.tempo` = song1 manifest tempo (≈ 109.957) and `SKIN_PIPELINE.tempo` = song2 manifest tempo (≈ 126.05).
- [x] 3.2 Add a guard test asserting each skin's `tempo` equals the manifest `tempo` for its `track.id` (single-source check).
- [x] 3.3 Confirm `SKINS` ordering = progression order and `nextSkin` wraps (last → first); keep `DEFAULT_SKIN = SKINS[0]` as the base skin.

## 4. Wave 3 — Slim `useSkinSwitch` (programmatic only)

- [x] 4.1 Remove `SKIN_STORAGE_KEY`, the mount-hydrate localStorage effect, and both `localStorage.setItem` calls (no persistence).
- [x] 4.2 Rename `cycleSkin` → `advanceSkin` (advance to `nextSkin` with the colour + audio crossfade); used only by song completion.
- [x] 4.3 Add `resetToBaseSkin()` that jumps to `SKINS[0]` instantly (no crossfade) for restart / new game.
- [x] 4.4 Remove `setSkin` (it is a toggle by another name) and the `cycleSkin` export from `SkinSwitchState`.
- [x] 4.5 Rewrite `src/game/skins/useSkinSwitch.test.ts` to the new programmatic-only surface (advance-to-next crossfades + wraps, reset-to-base is instant, no persistence); `crossfade.test.ts`/`skins.test.ts` unaffected.

## 5. Wave 4 — GameShell wiring + chrome cleanup

- [x] 5.1 Wire the tempo seam: `handleStart`/`handleRestart` push `DEFAULT_SKIN.tempo` before `controller.start()`; the `useSkinSwitch` onSwitch callback pushes `skin.tempo` on advance (latched at the next wrap). Also seeds tempo on controller mount.
- [x] 5.2 Point `engine.onSongComplete` at `advanceSkinRef.current()` (the renamed `advanceSkin`); kept the live-ref pattern so it never closes over a stale skin.
- [x] 5.3 Restart-to-base: `handleStart` + `handleRestart` call `resetToBaseSkin()`, re-push the base tempo + skin index, and set the initial track to `DEFAULT_SKIN.track`.
- [x] 5.4 Remove the N-key skin hotkey `useEffect` and drop "n skin" from `ControlsContract` + the `Cheatsheet` atom.
- [x] 5.5 Remove the skin-cycle button + `onCycleSkin`/`skinLabel`/`SkinChoice` from `StartView`; remove the skin selector from `PauseOverlay`/`SettingsBlock` (`skinId`/`onSelectSkin`).
- [x] 5.6 Score legibility: lifted the in-play score out of `.recede` onto a legible backing chip (blurred dark backing + accent border + bright accent text), kept top-left + `data-testid="score"`.
- [x] 5.7 Remove the dead bottom decorative bar (bottom `tickrail` + duplicate bottom pause-hint) in `PlayHud`; kept the timeline-sweep caret (real `sweepX`).
- [x] 5.8 Remove the "TITLE" button from `GameOverView` + the `onTitle`/`goToTitle` handler; game over keeps PLAY AGAIN + RANKS.
- [x] 5.9 Verified exactly one `<main>` landmark (`grep` shows only `GameShell.tsx` `.screen` root); all remaining controls are real `<button>`s.

## 6. Wave 5 — Auth fix (code + deploy config; per confirmed defects)

- [x] 6.1 NOT NEEDED — `trustHost`/`NEXTAUTH_URL` is dead config: the live diagnostic showed origin derivation already works (the providers endpoint returns the correct callback URL). Per the diagnostic, do not add it. The real code fix is the wrangler compat bump (below).
- [x] 6.2 The real code fix: bump `wrangler.jsonc` `compatibility_date` 2025-05-05 → 2025-09-23 (keeping `nodejs_compat` + `global_fetch_strictly_public`) so the Worker's node http CLIENT support lets NextAuth v4's openid-client run Google discovery — fixing the server-side `OAuthSignin`. Verified: `next build`, `opennextjs-cloudflare build`, e2e + repro stay green.
- [ ] 6.3 Deploy config (not committed; EXTERNAL — Rai): set Worker secrets/vars `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CONVEX_AUTH_ISSUER_DOMAIN`, `CONVEX_AUTH_APPLICATION_ID`, and client var `NEXT_PUBLIC_CONVEX_URL`. (The live providers probe shows the Google id/secret are already set; this lists the full required set.)
- [ ] 6.4 EXTERNAL (Rai): register `https://llmines.e8n.dev/api/auth/callback/google` as an authorized redirect URI in the Google OAuth client. Noted in `RealAccountProvider.tsx`.
- [ ] 6.5 EXTERNAL (Rai): set `CONVEX_AUTH_ISSUER_DOMAIN` on the Convex deployment to the deployed origin so `ctx.auth.getUserIdentity()` is populated (defect 3 — verify after sign-in works). Noted in `RealAccountProvider.tsx`.
- [ ] 6.6 EXTERNAL manual gate (Rai, post-deploy): on `llmines.e8n.dev`, Google sign-in succeeds → username select shows for a new user → a signed-in game over submits a score the backend accepts. Re-run the diagnostic probe (`POST /api/auth/signin/google` should return an `accounts.google.com` authorize URL, not `?error=OAuthSignin`).

## 7. Wave 6 — Tests + gates

- [x] 7.1 Re-pointed controller BPM tests at the track-tempo seam (`controller.v2.test.ts` 9.1-9.6): sweep speed follows `setTempo` latched at the pass boundary (no mid-pass jump), clears don't change tempo/skin, `setSkinIndex` is render-only; pushed the canonical `BPM` in the 5.x/suspend timing tests; removed the old `skinIndex`/`skinBpm`/`clearsInSkin` assertions; `events.test.ts` mock keeps the still-present `skinIndex`/`bpm` RenderState fields.
- [x] 7.2 Updated `e2e/production-start.spec.ts`: new chrome-contract test (no skin toggle, inert N key, no bottom pause-hint, score visible) preserving the `score`/`start-button`/`controls-cheatsheet` contracts. `lumines.spec.ts` only carried the test-api typedef (`setSkin` → `setTempo`); no chrome assertions there.
- [x] 7.3 Unit assertions: `useSkinSwitch.test.ts` proves `advanceSkin` advances + wraps and `resetToBaseSkin` returns to the base skin; `controller.v2` 9.6 proves a clear does NOT advance the skin index. (The onSongComplete→advanceSkin edge is GameShell wiring, covered by the slimmed hook surface + the engine's existing onSongComplete tests.)
- [x] 7.4 Gates green: `pnpm test` (442) · `pnpm typecheck` · `pnpm lint` (0/0) · `pnpm build` · `pnpm test:e2e:production-start` (8/8) · `node scripts/repro-autoplay.mjs` (PASS, RMS peak 0.122, exit 0). Also `opennextjs-cloudflare build` green post-compat-bump.
- [ ] 7.5 EXTERNAL (Rai): `pnpm cf:deploy` + confirm live — sweep in time with the music, skins advance on song completion, sign-in + score submit (gated on the external Worker secrets / Google console / Convex issuer steps in 6.3-6.6).
