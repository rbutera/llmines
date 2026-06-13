# LLMines

A browser **Lumines**-style puzzle game. 2×2 colour blocks fall onto a 16×10 grid; same-colour
2×2 squares form; a music-synced timeline bar sweeps left→right and clears them. Built with
**Next.js / React 19**, **Tone.js** (Web Audio), and deployed on **Cloudflare** at
[llmines.e8n.dev](https://llmines.e8n.dev).

> **This README documents the game's INTENDED DESIGN** — audio + gameplay — so another agent can
> understand exactly how it is supposed to work. The design is the owner's (Rai's), captured here
> with his **verbatim quotes** (typos preserved on purpose — they are quotes, not errors). Where a
> line is a summary rather than a quote, it is unquoted or marked "(paraphrased)".

The original game it clones — Lumines (Q Entertainment / Tetsuya Mizuguchi, PSP 2004) — is documented
in the vault notes `Lumines Mechanics.md` and `Lumines Faithfulness Research.md`. Read those for the
ground-truth mechanics this game is faithful to.

---

## 1. The core audio vision

The whole point of LLMines is that **the player's skill drives the music**. The success metric is
not "does audio play" — it is whether a bystander watching someone else play would feel they are
hearing the actual song, in order. Rai's rubric, verbatim:

> "Hiss isn't the issue. It's the fact that the song doesn't play in any meaningful way. We start.
> The rubric, the metric was that someone listening to someone else playing the game should feel
> like they're listening to the song from the beginning in a cohesive order, but it just jumps
> around. It doesn't make sense."

So the bar is **listener coherence**: play the song from the beginning, in a cohesive order, no
jumping around. Everything in the audio design below exists to satisfy that one rubric.

### The single most important rule: CLEARS gate progression

There was a wrong turn where an implementation made the song advance on its **own** musical clock
(an autonomous timeline), with clears only affecting intensity. Rai rejected that hard and
re-established that **clears drive the song forward** — that is the core mechanic, not an option:

> "the song advances through its sections IN ORDER on its own musical clock (NOT gated by clears)"
> what the actual fuck, florence... when did i say dont gate it on clears

(That quote is Rai reading back the autonomous model and rejecting it. The current engine implements
the **clear-gated** model. The autonomous-timeline detour lives in the git history as
`2ac70c8 wave1(audio): N-tier engine + autonomous timeline` and was reverted by
`d61c084 fix(audio): restore CLEAR-GATED horizontal progression (player's clears drive the song)`.
Do **not** reintroduce an autonomous timeline.)

---

## 2. Audio design — the intended model

Each song is a sequence of **segments** played **in order**. Each segment is pre-rendered at several
cumulative **tiers** (stem layers). Two orthogonal progressions, both driven by clears, both
quantised to musical loop boundaries:

### 2a. HORIZONTAL — clear-gated segment advance (the song's position)

The original brief, captured verbatim in the bead `focused-0gg0` under "DESIRED MODEL (Rai's
brief...)":

> - Progression is GATED BY CLEARS, FORWARD-ONLY: pass a clear-threshold -> the backing transitions
>   (on a bar boundary / end-of-bar) to the NEXT segment. Threshold TBD by experiment. Once it has
>   progressed it never goes backwards. If a progression/transition is already in flight, further
>   clears don't stack another until it finishes. You CANNOT fast-forward/queue (no skipping to the
>   end by spamming clears) — you should hear the whole song as you play.

In short:

- **Clear-gated.** The current segment loops in place until the player has cleared enough.
- **Forward-only.** Once advanced, never goes back.
- **One-step.** A burst of clears advances **one** segment, not several.
- **In-flight-locked.** While a transition is mid-flight, further clears do not queue another.
- **No fast-forward.** You cannot spam clears to skip to the end — you must hear the whole song.
- **Bar-aligned.** Transitions land on a bar boundary so the hand-off is musical.

When the song advances past its final (TERMINAL) segment, the host swaps to the next song — a **skin
switch**. From the brief:

> - When all segments are exhausted -> switch to the next song (skin switch).

### 2b. VERTICAL — cumulative stem layers (the song's fullness)

Each segment is rendered at N cumulative tiers: `tier0` = the backing bed (drums), then `+bass`,
`+instruments`, up to the top tier = the full mix **including vocals**. Clears reveal higher tiers.

The original layer model, in Rai's words (voice-transcribed during the first spec):

> "In its simplest form there would be at least three layers: 1. The bass, percussion, kind of like
> a background loop, which is always playing on repeat no matter what the gameplay is happening. 2.
> The layer on top of that is kind of like instrumentation and stuff like that. 3. The layer on top
> of that is vocals. ... In our version of Lumiere, the topmost layer is not played by the song or
> the mix. It's just played by the player; that's the player's contribution to the song. The bottom
> layer is always going to play on loop and the second and third layers, the instrumentation and the
> vocals, will get played by clearing."

Key vertical rules:

- **Sticky within a segment.** Once a tier is revealed it stays — no decay, never sheds.
- **Floor carried into the next segment** so a fresh section never resets to bare.
- **Cumulative renders, not live summing.** At steady state exactly one bed player has non-zero gain
  (≤2 across a crossfade), which is the no-hiss mechanic — the runtime never sums many stems.

Two refinements Rai added after a playthrough (`4509c7e feat(audio): 3 gameplay-feel refinements`):

**Minimum 2 layers** — the bed alone is too thin:

> "one thing i noticed is that the base number of layyers is too low. so we should start at 2 layers
> minimum"

**Reaching vocals makes advancing mandatory** — if the top (vocal) layer is playing in a segment,
the song must move on rather than loop the vocal forever:

> "the next thing i noticed is that if we are playing vocals in one segment, then progression to next
> segment is mandatory"

### 2c. Segment structure per song

Songs are deconstructed into ordered, bar-aligned, cleanly-looping sections. From the brief
(`focused-0gg0`):

> Skin 1: instrumental intro, verse1, build, beat-drop+chorus, instrumental break, verse2, build,
> beat-drop, chorus, bridge, beat-drop, chorus, instrumental outro.
> Skin 2: intro, verse1, build, beat-drop, chorus, verse2, build, beat-drop, chorus, bridge,
> instrumental break, chorus, instrumental outro.

And the cutting mechanic:

> - Detect where segments start/end across ALL stems; cut each segment so it LOOPS CLEANLY (derive
>   bar length from BPM + beats; chunk = whole number of bars).
> - One stem = the BACKING track: loops continuously + musically in the background for the current
>   segment (sounds good looping forever because it's bar-aligned).
> - Other stems (vocals/melody/etc) of that segment do NOT play until the player makes progress; they
>   layer in at a natural bar-aligned point.

Some sections are meant to loop indefinitely (intros, breaks) and some are meant to play through —
this is encoded per segment as `LOOPER` / `PROGRESSION` / `TERMINAL` in the manifest. (paraphrased
from Rai's "the intro can just repeat indefinitely and a break could just repeat indefinitely".)

### 2d. Per-action SFX

Distinct one-shots for each player action, drawn from the song's palette. From the brief:

> - PER-ACTION SOUNDS (distinct, per the stem palette): rotate sound, fast-drop sound, small-drop
>   sound, and a CLEAR-STAGE sound. "Clear stage" = the player completes a 2x2 same-colour square
>   (instant clear on drop, OR a connection that clears on the sweep pass). Each gets its own sound.

### 2e. Reset on game over

The music state must fully reset when the game ends — no carrying segment/tier state into the next
run:

> "also the music context / music state should reset completely on game over."

### 2f. Stems provenance (context for whoever regenerates assets)

The source stems came in two batches; the first was truncated, the second full-length:

> "i had to give you two sets of stems. the first set were cut short. then i signed up for studio
> 5.5, and sent yyou big 500+mb files."

Songs were generated on Suno (song 2's genre was deliberately changed from "Funky House" to "Phonk"
to blend with song 1). The full-length Studio 5.5 stems are the canonical source. (paraphrased.)

---

## 3. Gameplay requirements (Lumines mechanics)

LLMines is a faithful Lumines clone. The canonical mechanics (full detail in
`Lumines Mechanics.md` / `Lumines Faithfulness Research.md` in the vault):

- **Playfield: 16 columns × 10 rows.** The 16 is load-bearing — the timeline math assumes it.
- **Piece: a 2×2 block of 4 cells**, each independently one of two colours. Move L/R, rotate, soft
  drop, hard drop.
- **Overhang gravity (THE discriminator).** On lock the piece dissolves into 4 cells and each column
  gravity-packs; overhanging cells fall per-column until they rest. **No cell ever floats, no holes
  ever.** The fall is a smooth eased settle, not a snap. Get this wrong and it isn't Lumines.
- **Clear unit = 2×2 same-colour square** (never line-clears). Detected on the settled grid; can span
  pieces. Overlapping windows count: a W×H mono rectangle = (W−1)×(H−1) squares (2×3 = 2, 3×3 = 4).
- **Timeline / sweep.** A vertical bar sweeps L→R **one column per eighth-note**, full pass = 2 bars
  of 4/4, in sync with the music. A marked square clears only on the pass that **fully covers** it;
  after a clear, cells above fall (and can cascade).
- **Scoring.** ~40 pts/square; ≥4 squares in one pass triggers a multiplier; consecutive qualifying
  passes escalate it; soft-drop +1/row; field-clear bonuses.
- **Chain / special blocks** (~1 in 30 pieces): when cleared, flood-fill all same-colour orthogonally
  connected cells.
- **Skins.** Each skin = `{ visual theme + block palette + music track (with BPM) + SFX palette }`.
  Advancing to the next skin changes the track and therefore the sweep speed. At least 2–3 skins; in
  LLMines a skin switch happens when a song is exhausted (§2a).
- **Game over** = top-out (a new piece can't enter). Music state resets (§2e).

Two pieces of direction from Rai's playtests (paraphrased): blocks need real **physics / smooth
falling** (not a Tetris-style instant lock); placed blocks vs to-clear (marked) blocks must be
visually distinguishable (marked ones pulse/brighten); the canvas should be the only thing grabbing
attention.

---

## 4. How it's implemented now

### Audio engine

- **`src/game/audio/procedural/engine.ts`** — the manifest-driven, N-tier, loop-quantised,
  **CLEAR-GATED** interactive-audio engine. Its module docstring is the authoritative description of
  the runtime model (horizontal clear-gated forward-only one-step in-flight-locked advance; vertical
  sticky cumulative tier reveal with a carried floor; cumulative renders so ≤2 stems are ever
  audible). Read it before touching audio.
- **`public/audio/manifest.json`** — the served FINE5 cut. `song1` ("Especifico Primero", ~110 BPM):
  **12 segments × 4 tiers**; `song2` ("Verde el Pipeline", phonk, ~126 BPM): **10 segments × 5
  tiers**. Each segment carries `type` (`LOOPER`/`PROGRESSION`/`TERMINAL`), `bars`, `barWindowSeconds`,
  `character`, and the cumulative `tiers` map (`tier0..tierN-1` → `.opus` files). The engine reads the
  tier count **per segment** from this manifest, so it is tier-count-agnostic.
- **`scripts/audio/`** — the asset pipeline: `analyze-structure.py` (librosa BPM/bar/section
  analysis), `cut-plan.json`, `render-tiers.py` (cumulative tier renders), `render-sfx.py`,
  `validate-stems.py`, `check-loops.py` (clean-loop verification), `transcode-and-manifest.py`
  (→ `.opus` + manifest emit).
- **`src/game/audio/procedural/sfxRouting.ts`** — the preset-free action→SFX map
  (rotate / soft-drop / hard-drop / clear). The old A/B/C "audio mix preset" system was removed
  (`d9aeee0 wave2(audio): ... remove A/B/C preset system`).

### The autoplay gotcha (important)

Tone.js eagerly constructs an `AudioContext` at module-eval. If that happens **off** a user gesture,
strict-autoplay browsers permanently block it and a later in-gesture resume produces **no audible
output** — the recurring "AudioContext was not allowed to start" bug. The engine therefore loads Tone
**lazily, inside the `unlock()` user gesture** (the Start click). Never static-import the `tone`
barrel into a module that loads at mount. (`9852c30 fix(audio): construct AudioContext in-gesture`.)

### Strict-autoplay regression harness

- **`scripts/repro-autoplay.mjs`** — launches **real (non-headless) chromium** with
  `--autoplay-policy=document-user-activation-required`, navigates to a locally-served production
  build, clicks Start, drives gameplay, and measures **actual** audio output via an `AnalyserNode`
  spliced onto every node connecting to the destination. RMS above the floor = real audible output;
  it also fails if the autoplay console error fires.

  **Why it exists:** headless chromium **auto-allows** audio, so headless tests can never catch the
  autoplay-block bug or judge real output. Every prior "verified" audio claim measured mechanics
  (segment advanced, ≤2 stems, RMS>0) and missed feel. This harness is the strict-autoplay gate;
  the final arbiter of feel is still **Rai's ear-check** (the design was only signed off after
  "ok i'm happy with this" on the FINE5 cut — `focused-0gg0`).

### Verification gates

`pnpm test` (vitest) · `pnpm typecheck` · `pnpm lint` · `pnpm build` ·
`pnpm test:e2e:production-start` (Playwright production-start audio probe) · then
`node scripts/repro-autoplay.mjs <baseURL>` for the strict-autoplay check.

---

## 5. Context another agent needs

- **Source stems** live in `audio-src/` (gitignored — large, local-only; see `.gitignore`). The
  manifest + rendered `.opus` tiers under `public/audio/` are the committed, served assets. To
  regenerate, you need the source stems (the full-length Studio 5.5 set, §2f) and the `scripts/audio/`
  pipeline.
- **FINE5 manifest shape:** `{ version, songs: [ { id, title, tempo, barSeconds, segments: [ { id,
  type, bars, lengthSeconds, barWindowSeconds, character, tiers: { tier0.. } } ] } ] }`. Tiers are
  **cumulative** (tier1 already contains tier0's content), so the engine crossfades between adjacent
  tiers with a constant-sum (linear) ramp — not equal-power, which would +3 dB-bump the shared bed.
- **Deploy:** Cloudflare via OpenNext — `pnpm cf:deploy` (build + `opennextjs-cloudflare deploy`),
  custom domain `llmines.e8n.dev` (see `wrangler.jsonc`). README-only changes need no redeploy.
- **Repo conventions:** personal repo, work on `main`, no feature branches; AI attribution is fine
  here. Package manager is **pnpm**.

### The key design lesson

**Clears drive the song. Do NOT make it autonomous.** The song's horizontal position is gated by the
player's clears (forward-only, one-step, no fast-forward); clears also reveal cumulative stem layers
vertically (sticky, min 2, vocals→mandatory-advance). An autonomous musical timeline was tried and
explicitly rejected (§1). The whole experience must satisfy the listener-coherence rubric: a
bystander should feel they're hearing the song "from the beginning in a cohesive order."

---

## Music credit (required)

> Sano - SET ME FREE [NCS Release]. Music provided by NoCopyrightSounds. https://youtu.be/e1QIqXmZ2os

NoCopyrightSounds tracks are free for public/commercial use **with credit**. This credit string must
appear in the deployed game's footer/credits. (The shipped songs "Especifico Primero" / "Verde el
Pipeline" are Suno-generated for the skins; NCS credit is retained for the original scaffold fixture.)

## Stack & tooling

Scaffolded with `create-t3-app` (App Router + TypeScript + Tailwind). Audio via **Tone.js** /
Web Audio. Deployed on **Cloudflare** via **OpenNext**.

| Tool | Version |
|---|---|
| node | 24.16.0 |
| pnpm | 10.32.1 |
| next | 15.5.19 |
| react / react-dom | 19.2.7 |
| typescript | 5.9.3 |
| tailwindcss | 4.3.0 |

### Scripts

```bash
pnpm dev                          # dev server (localhost:3000, turbo)
pnpm build                        # production build
pnpm start                        # serve the production build
pnpm check                        # lint + typecheck
pnpm test                         # vitest (unit)
pnpm test:e2e:production-start    # Playwright production-start audio probe
pnpm cf:deploy                    # build + deploy to Cloudflare (llmines.e8n.dev)

node scripts/repro-autoplay.mjs http://localhost:3201   # strict-autoplay audio gate
```
