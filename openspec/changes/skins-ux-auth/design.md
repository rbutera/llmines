## Context

LLMines today runs THREE overlapping "skin" notions:

1. **Core `SKINS`** (`src/game/core/skins.ts`) — an ordered list of `{ bpm, blockPalette, visualTheme }` at 120/144/168 BPM. `advanceSkin` (`sweep.ts:123-137`) advances `skinIndex` every `SKIN_ADVANCE_THRESHOLD = 20` cleared squares, and the controller reads `skinBpm(state.skinIndex)` to drive the sweep speed (`controller.ts:431`).
2. **Host skin bundles** (`src/game/skins/skins.ts`) — `{ id, label, track, board, chrome }`: the colour world (3D board + DOM chrome palettes) plus the soundtrack (`TrackBundle`). The ordered `SKINS` list here is cycled by `useSkinSwitch` on the N key / a button, and on `engine.onSongComplete`.
3. **The audio engine's segments** — each song plays at its own manifest `tempo` (song1 ≈ 109.957, song2 ≈ 126.05).

The two BPM worlds never agree, so the sweep bar is never in time with the music — the defining Lumines coupling (audit A6, README §3b finding 2: "the sweep speed IS the active skin's music BPM"). Visual palette (`skinIndex`) and soundtrack advance on unrelated schedules. On top: restart rehydrates the persisted skin instead of the base skin (audit C), a skin-toggle button + N hotkey exist that shouldn't, dead chrome confuses, and Google sign-in is broken.

This change **unifies on the host bundle** as the single skin definition, **drives the sweep BPM from the active track's manifest tempo**, makes **song completion the only progression trigger**, resets to the base skin on restart, strips the toggle + dead chrome, and **root-causes and repairs Google sign-in**.

**Merge order.** This change merges AFTER `core-lumines-fidelity`, which rewrites `sweep.ts` and reshapes `GameState`/`SweepPass` (mark-on-pass + batch erase + faithful scoring + spawn staging + seeding + replay + clear telemetry). It does NOT touch skins. So the `skinIndex`/`clearsInSkin`/`advanceSkin` deletion here is designed against `core-lumines-fidelity`'s POST-change `sweep.ts` and `GameState`. It also reads the manifest tempo the `audio-truth` engine already loads (`getAudioState().bpm`); `audio-truth` owns `onSongComplete` semantics and the SFX/advance rules, so this change only consumes the existing `onSongComplete` hook and the existing `bpm` accessor — it adds no new audio-engine behaviour.

**Constraints.** Personal repo, work on `main`, no feature branches, pnpm. The controller must stay audio-agnostic (its only time source is the injected `Clock`; it must not import the Tone engine). The strict-autoplay harness (`scripts/repro-autoplay.mjs`) and the production-start e2e must stay green. a11y landmark rule: exactly one `<main>` (the `.screen` root in `GameShell`).

## Goals / Non-Goals

**Goals:**

- One skin system. The host bundle (`src/game/skins/skins.ts`) is the single source of truth: `id`, `label`, `track` (carrying tempo via the manifest), `board` palette, `chrome` palette. The ordered `SKINS` list IS the progression sequence.
- Delete the core skin system entirely: `src/game/core/skins.ts` (`SKINS`, `skinAt`, `skinBpm`, `Skin`), `advanceSkin` in `sweep.ts`, and the `skinIndex` + `clearsInSkin` fields from `GameState`, plus `SKIN_ADVANCE_THRESHOLD` in `constants.ts`.
- Sweep BPM comes from the active skin's track tempo, latched at pass boundaries (the existing `currentSweepBpm` latch mechanism is preserved; only its source changes).
- Skin advances ONLY on song completion (`engine.onSongComplete` → next skin). No squares-counter progression.
- Restart and post-game-over new game reset to `SKINS[0]` (base skin). localStorage persistence of the chosen skin is removed.
- The skin toggle is removed: the HUD cycle control(s) AND the N hotkey. `useSkinSwitch` slims to programmatic transitions only (`setSkin` / advance-to-next-on-song-complete + reset-to-base).
- The score is visibly readable during play.
- Dead chrome removed: the unexplained bottom bar and the pointless "title" button.
- Google sign-in works on `llmines.e8n.dev`: sign in, username selection, score submit on game over.

**Non-Goals:**

- No change to the audio engine's segment/tier/advance mechanics (owned by `audio-truth`) beyond consuming its existing `bpm` accessor and `onSongComplete` hook.
- No change to core sweep/scoring/spawn mechanics (owned by `core-lumines-fidelity`).
- No new skins, no per-skin BPM speed-up variants (README D3's "flat difficulty curve" is acknowledged but adding faster songs is out of scope here — see Open Questions).
- No auth provider beyond Google. No new account features (username/leaderboard already exist; this change only makes the path actually work in production).
- No redesign of the 3D renderer or the cockpit aesthetic beyond removing the two dead elements and ensuring score legibility.

## Decisions

### D1. The host bundle is the single skin; the core skin system is deleted

`src/game/skins/skins.ts`'s `Skin` becomes the canonical type. It already carries `id`, `label`, `track`, `board`, `chrome`. The ordered `SKINS = [SKIN_NEON, SKIN_PIPELINE]` is the progression order. We delete `src/game/core/skins.ts` and its test, remove `export * from "./skins"` from `src/game/core/index.ts`, and remove the `skinBpm` import/use there.

**Why not keep a thin core skin for BPM?** Because the BPM now comes from the track tempo (D2), the core skin's only remaining job (supplying BPM + a render palette nobody downstream consumes once the host palette owns colour) evaporates. Two skin systems is the root defect (A6); collapsing to one is the whole point.

*Alternative considered:* make the core skin a projection of the host bundle (core reads host tempo). Rejected: the core must stay pure (no audio/host imports), and threading host tempo into core state just relocates the duplication. The clean seam is the controller (D2).

### D2. Sweep BPM = the active track's manifest tempo, fed to the controller via a tempo seam

The controller already latches BPM at pass boundaries (`currentSweepBpm`, `controller.ts:429-434`): it only re-reads the BPM when `sweepX === 0`, so a mid-pass change never jumps the bar. We keep that latch and change only the SOURCE.

**Seam:** add `setTempo(bpm: number)` to `GameController`. It stores a `private pendingBpm` (or `tempoBpm`) the latch reads at the next wrap — `currentSweepBpm()` becomes "if at a pass boundary, adopt the latest set tempo; else keep the latched one." Default before any `setTempo` call: a sensible constant (the song1 tempo ≈ 110, or a `FALLBACK_BPM` constant) so the bar moves on the first pass even before audio reports.

The controller stays audio-agnostic: it receives a plain number, never imports the engine. `GameShell` owns the wiring — it already holds both the active skin and the audio engine. On skin switch / initial track set, GameShell calls `controller.setTempo(activeTrackTempo)`. The tempo value comes from the manifest: the engine already exposes the loaded song's tempo via `getAudioState().bpm`. To avoid a race (audio loads async), GameShell reads the tempo from a synchronous source — the manifest tempo keyed by track id — exposed as a small pure helper (e.g. `trackTempo(track.id)` reading a static tempo map, OR a `tempo` field added to `TrackBundle`/`Skin`). Adding a static `tempo` to the `Skin` bundle (song1 ≈ 109.957, song2 ≈ 126.05) is the cleanest: it keeps the value next to the skin's other identity data and needs no async read.

`RenderState.bpm` (render-only, drives the HUD gauge) follows: it becomes the controller's current latched sweep BPM rather than `skinBpm(skinIndex)`.

**Why latch at the pass boundary (not instantly)?** Preserves the existing no-discontinuity guarantee: a skin switch lands on a fresh pass so the bar speed changes between traversals, never mid-traversal. The audio crossfade and the visual crossfade already run ~1s; the bar adopting the new tempo on the next wrap reads as musical.

*Alternative considered:* controller reads tempo live from `getAudioState().bpm` every frame. Rejected: couples the controller to the audio engine (breaks purity + testability) and the async load means `bpm` is the fallback until the song loads, causing a visible tempo pop. A pushed, latched tempo from a synchronous skin field is clean and testable (a test calls `setTempo` and asserts the sweep speed changes at the next wrap).

### D3. Skin advances only on song completion; restart resets to the base skin

Progression is removed from the core (no `advanceSkin`, no `skinIndex`, no `clearsInSkin`). The ONLY advance path is `engine.onSongComplete → advance to next skin`, which already exists (`GameShell.tsx:127` wires `onSongComplete = () => cycleSkinRef.current()`). We rename the host hook from "cycle" to an explicit "advance to next skin" to drop the toggle connotation, but the wiring is the same edge.

**Wrap vs hold at the last skin.** Decision: **wrap** (last skin → first skin), matching Rai's model ("2 songs cycle" — the skin switches on song exhaustion and the two songs cycle endlessly). The current `nextSkin` already wraps (`(idx + 1) % SKINS.length`); we keep that. This gives an endless Challenge-like loop. (Holding on the last skin would stall the music progression at the end of song 2 forever, which contradicts the endless-mode intent.)

**Restart → base skin.** `handleRestart` and the post-game-over new-game path call a new `resetToBaseSkin()` on the skin hook, which sets the active skin to `SKINS[0]` (no crossfade — instant, like a fresh load) and the audio engine is already reset via `resetForNewGame()` + `setInitialTrack(SKINS[0].track)` on start. We remove the localStorage hydrate + persist so the chosen skin never carries across runs.

### D4. Remove the skin toggle (control + N hotkey); slim `useSkinSwitch`

`useSkinSwitch` currently exposes `cycleSkin` (button/key) + `setSkin` (programmatic) + the persistence. After this change it exposes:

- `skin`, `board`, `chrome`, `transitioning` (unchanged — the live crossfade).
- `advanceSkin()` (renamed from `cycleSkin`, called ONLY by `onSongComplete`) — advances to `nextSkin` with the colour + audio crossfade.
- `resetToBaseSkin()` — jump to `SKINS[0]` instantly (restart / new game).

We delete: the `SKIN_STORAGE_KEY` persistence (the mount-hydrate effect and both `localStorage.setItem` calls), the N-key `useEffect` in `GameShell` (lines 240-258), the `onCycleSkin`/skin-cycle button in `StartView`, and the skin selector in `PauseOverlay`/`SettingsBlock` (the toggle must not survive anywhere). `setSkin` is removed unless the pause skin-picker is intentionally kept — it is NOT (it is a toggle by another name), so `setSkin` goes too.

The `ControlsContract` cheatsheet string and the `Cheatsheet` atom drop the "n skin" entry.

### D5. Chrome: visible score, remove the bottom bar and the title button

- **Score visibility.** The score already renders top-left in `PlayHud` at `fontSize: 64` (`screens.tsx:313-334`). The README complaint ("score is hidden at the top") means it is not reading as legible against the fullscreen board — it sits inside a `.recede` wrapper (dimmed) and may be lost against bright board cells. Fix: lift the score out of `.recede`, give it a solid/legible treatment (a backing chip or stronger contrast token), and keep it top-left (respecting "the canvas is the only thing grabbing attention" — top-left is peripheral, not center-stage). The score keeps its `data-testid="score"` (the e2e restart assertion depends on it).
- **Remove the bottom bar.** The "pointless UI element at the bottom" maps to the bottom `.tickrail` / pause-hint strip area in `PlayHud` that is decorative and unexplained. We remove the redundant bottom decorative rail + the duplicate "esc · ❚❚ pause" hint (the timeline sweep itself stays — it is functional). Concretely: delete the bottom `tickrail` block and the standalone bottom pause-hint; the timeline-sweep caret block is retained because it shows real `sweepX`.
- **Remove the "title" button.** The `TITLE` button in `GameOverView` (`overlays.tsx:241-248`) and its `onTitle`/`goToTitle` handler are removed. Game over offers PLAY AGAIN + RANKS only; there is no separate title screen to return to mid-session (Start is the cold-load screen). `StartView` is reached only on cold load.

**Final control surface (enumerated):**

- **Start phase:** ENGAGE (start), CONTROLS (open controls overlay), SIGN IN / SIGNED IN (auth), LEADERBOARD. NO skin-cycle button.
- **Playing phase:** Pause button (and Esc). Score readout (top-left, visible). Tempo/BPM gauge (read-only). NEXT queue (read-only). Timeline sweep caret (read-only). NO skin toggle.
- **Pause overlay:** RESUME, END RUN, volume slider, mute toggle, control-scheme cheatsheet. NO skin selector.
- **Game-over phase:** PLAY AGAIN (restart → base skin), RANKS (leaderboard). NO title button.
- **Username select:** shown after first sign-in (unchanged).
- **Leaderboard overlay:** reachable from Start + Game Over (unchanged).

All remaining controls are real `<button>`s, keyboard-reachable, inside the single `<main>` landmark.

### D6. Auth root cause + fix

**Stack:** NextAuth v4 (`4.24.14`) App-Router handler at `src/app/api/auth/[...nextauth]/route.ts`, Google provider in `src/server/auth.ts`, client uses `next-auth/react` (`SessionProvider`/`signIn("google")`/`useSession`) in `RealAccountProvider.tsx`. Identity is forwarded to Convex, which validates the NextAuth JWT via `convex/auth.config.ts`. Deployed on Cloudflare Workers via OpenNext.

**Three concrete, code/config-verified defects — any one breaks production sign-in:**

1. **Google provider registers ONLY if `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` are present at runtime** (`src/server/auth.ts:20-33` — `googleConfigured` gates the providers array; empty array ⇒ `signIn("google")` is a no-op). These are server env vars. On Cloudflare Workers (OpenNext) they must be set as Worker **secrets/vars**; they are NOT in `wrangler.jsonc`, and `.env` is gitignored, so there is no evidence they exist in the deployed Worker. If unset in production, the provider list is empty and sign-in silently does nothing — matching "login via Google just doesn't work."
2. **NextAuth v4 needs `NEXTAUTH_URL` (or `trustHost`) to derive callback/redirect URLs behind a proxy.** `.env.example` documents `NEXTAUTH_URL` but `src/env.js` never reads it and `authOptions` does not set `trustHost`. Behind Cloudflare's edge, NextAuth v4 cannot reliably infer the origin, so the OAuth redirect URI / callback can be wrong → the Google round-trip fails. The Google OAuth client's authorized redirect URI must also be exactly `https://llmines.e8n.dev/api/auth/callback/google`.
3. **Convex trusts `https://example.com` by default** (`convex/auth.config.ts:14` — `CONVEX_AUTH_ISSUER_DOMAIN ?? "https://example.com"`). Even if sign-in completes, an unset issuer means Convex rejects the JWT, so `ctx.auth.getUserIdentity()` is null and `submitScore` is unauthenticated → score submit on game over fails for "signed-in" users.

**Why diagnostics must run first.** All three are statically plausible, but WHICH is firing in the live `llmines.e8n.dev` deployment cannot be determined from the repo alone (the failure depends on what is actually set in the Cloudflare Worker's env + the Google console + the Convex deployment, none of which are in version control). So the first task in the auth stream is a runtime diagnostic: hit `https://llmines.e8n.dev/api/auth/providers` (empty/`{}` ⇒ defect 1), attempt the Google flow and inspect the redirect URI + any callback error (⇒ defect 2 + the console redirect-URI registration), and check whether a completed session yields an authenticated Convex identity (⇒ defect 3). The fix set is then the union of whichever defects the diagnostic confirms.

**Repair (code-side, regardless of which config defect fires):**

- Set `trustHost: true` in `authOptions` (NextAuth v4 needs this behind the Cloudflare proxy) so origin derivation does not depend on `NEXTAUTH_URL` being plumbed through `process.env` on the Worker.
- Ensure server env (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CONVEX_AUTH_ISSUER_DOMAIN`, `CONVEX_AUTH_APPLICATION_ID`) and client env (`NEXT_PUBLIC_CONVEX_URL`) are available to the OpenNext Worker at runtime (Worker secrets/vars — a deploy-config step, documented in the tasks; secrets are NOT committed).
- Verify the OpenNext build maps these into the server runtime (OpenNext on Workers exposes bindings via `process.env`/`getCloudflareContext`; if the t3 `env.js` validation runs at build with `SKIP_ENV_VALIDATION` it must still resolve the vars at request time).
- Register `https://llmines.e8n.dev/api/auth/callback/google` as an authorized redirect URI in the Google OAuth client (external console step — flagged for Rai, not automatable here).
- Set `CONVEX_AUTH_ISSUER_DOMAIN` to the deployed origin and configure the Convex deployment to trust it.

**What is code vs config.** The code fix is small (`trustHost`, plumbing `NEXTAUTH_URL` into `env.js`/runtime if needed, any OpenNext runtime declaration). The rest is deployment config (Worker secrets, Google console redirect URI, Convex issuer) — these are environment changes, captured in tasks as explicit steps and verified by the diagnostic + a real sign-in on `llmines.e8n.dev`. Secrets are never committed.

## Risks / Trade-offs

- **[Coordinating GameState shape with `core-lumines-fidelity`]** → That change reshapes `GameState` (it drops `softDropBonus`? adds seed/replay/telemetry) and rewrites `sweep.ts`. Removing `skinIndex`/`clearsInSkin`/`advanceSkin` must rebase onto its final shape, not today's. Mitigation: this change merges AFTER it; the implementer reads `core-lumines-fidelity`'s merged `sweep.ts`/`types.ts` and removes the skin fields there. If `core-lumines-fidelity` already removed them (it touches `sweep.ts` heavily), this change just confirms their absence and removes the controller/HUD readers.
- **[Tempo pop on first pass before audio loads]** → The controller defaults to a fallback BPM until `setTempo` is called with the real track tempo. If the skin field tempo is set synchronously (D2), `setTempo` runs at start before the first wrap, so there is no pop. Mitigation: GameShell calls `controller.setTempo(skin.tempo)` in `handleStart`/`handleRestart` before `controller.start()`.
- **[Removing the pause skin selector changes a shipped affordance]** → Some players may expect to pick a skin. But the brief is explicit (no toggle; skins advance only on song completion). Trade-off accepted per the design intent.
- **[Auth fix depends on external config not in the repo]** → The diagnostic may show the failure is purely config (Worker secrets / Google console), in which case there is no code change to "test." Mitigation: the verification is a real sign-in on `llmines.e8n.dev` (manual gate, like the audio ear-check), plus the `trustHost`/env plumbing lands as code so the configured deployment works deterministically.
- **[`getAudioState().bpm` vs static skin tempo divergence]** → If the static `Skin.tempo` and the manifest `tempo` drift, the bar and music desync again. Mitigation: a unit test asserts each `Skin.tempo` equals the manifest tempo for its `track.id` (single source check), so a manifest re-cut that changes tempo is caught.
- **[e2e production-start asserts current chrome]** → Removing the bottom bar / title button + lifting the score may break selectors. Mitigation: the e2e is updated in lockstep (it is in scope); the `data-testid="score"`, `start-button`, `restart`, `game-over`, `controls-cheatsheet` contracts are preserved.

## Migration Plan

1. Land AFTER `core-lumines-fidelity` (sweep.ts/GameState owner) and alongside/after `audio-truth` (engine `bpm` + `onSongComplete` consumer).
2. Core deletion (skins.ts, advanceSkin, GameState fields, SKIN_ADVANCE_THRESHOLD) + controller tempo seam — pure, unit-tested.
3. Host skin + `useSkinSwitch` slim + GameShell wiring (tempo push, restart-to-base, toggle removal) + chrome cleanup.
4. Auth diagnostic → confirmed-defect fixes (code + deploy config) → real sign-in verification on `llmines.e8n.dev`.
5. Gates: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test:e2e:production-start` · `node scripts/repro-autoplay.mjs`.
6. Deploy via `pnpm cf:deploy`; set Worker secrets/vars; verify sign-in + score submit live.

**Rollback:** revert the merge; the audio engine + core fidelity changes are independent and unaffected.

## Open Questions

- **Flat difficulty curve (README D3).** With only two songs at ≈110/≈126 BPM, the sweep-speed difficulty range is narrow. Adding faster songs or per-skin speed-up variants is out of scope here but should be a follow-up if difficulty progression matters. Decision deferred to Rai.
- **Does the live failure include defect 3 (Convex issuer)?** Only the diagnostic against the live deployment + Convex dashboard can confirm; the fix set adjusts accordingly.
- **OpenNext + NextAuth v4 runtime.** If the diagnostic shows the handler needs an explicit Node runtime declaration or a `getCloudflareContext` env shim under OpenNext, that is added in the auth fix task; left open until the diagnostic confirms the OpenNext env-binding behaviour.
