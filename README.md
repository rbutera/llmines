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

> "In its simplest form there would be at least three layers:
> 1. The bass, percussion, kind of like a background loop, which is always playing on repeat no matter what the gameplay is happening.
> 2. The layer on top of that is kind of like instrumentation and stuff like that.
> 3. The layer on top of that is vocals.
>
> I guess there's a fourth layer, actually, which is ad libs and other sound effects. If you're listening to the master mix of the song, all four of those play contiguously and the ad libs are playing at a set interval or at set times in the song.
>
> In Lumiere, in our version of Lumiere, the topmost layer is not played by the song or the mix. It's just played by the player; that's the player's contribution to the song. The bottom layer is always going to play on loop and the second and third layers, the instrumentation and the vocals, will get played by clearing. I'm thinking like one clear or a small number of clears and then you start getting the instrumentation..."

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

## 3b. Verified Lumines mechanics reference (deep research, 2026-06-13)

Adversarially-verified reference for the original Lumines (PSP 2004) + Lumines Arise (2025),
produced by a 107-agent research workflow (25 sources fetched, 95 claims extracted, 25 verified by
3-vote adversarial panels, 16 confirmed). Sources: harddrop.com/wiki/Lumines, tetris.wiki/Lumines,
Wikipedia, lumines.fandom.com (Timeline / Challenge Mode / Lumines II), diplograph.net Lumines
Remastered notes, cglab.ca Aloupis et al. academic paper, GamingBolt Arise developer deep-dive,
Push Square / GameSpot Arise reviews. This section is the implementation ground truth; it
supersedes the vault notes referenced above where they disagree.

### Confirmed (high confidence unless noted)

1. **Field & pieces.** 16 wide × 10 tall. Pieces are 2×2 (O-tetromino) of dark/light sub-blocks,
   **entering above the top centre of the field** (the visible field is fully usable; game over =
   blocks pile to the top).
2. **Timeline formula.** The sweeper moves **one column per eighth-note** of the current skin's
   music. One full pass = 16 eighth-notes = exactly **two 4/4 bars at any BPM** (the designer chose
   the 4/4 mandate to match the 16-column field). Skin BPM range in practice ≈60-90 BPM (slowest,
   2-3 cols/s, sources disagree which skin is slowest) up to 180 BPM (6 cols/s). **The sweep speed
   IS the active skin's music BPM** — this coupling is the game.
3. **Difficulty is the BPM trade-off.** Fast skins shrink the window to build big combos; slow
   skins give combo time but risk the field filling. Difficulty progression = the skin sequence's
   BPM curve, not a separate level system.
4. **Mark-then-batch-erase.** Squares are NOT erased on formation. The timeline **marks** square
   cells as it passes over them (visual change only). Erasure fires **as a batch when the timeline
   reaches a column with no marked blocks (a gap) or the right edge** — i.e. per contiguous marked
   GROUP, after the bar fully passes that group. Overlapping squares merge into one group and erase
   together. Gravity drops the stack after the group erase (cascades resolve on later passes).
   Squares completed mid-pass ahead of the bar ARE marked + erased on the current pass.
5. **Scoring (Challenge Mode), medium confidence on exact values.** 1-3 squares in a sweep = **40
   pts each** (40/80/120). **4+ squares triggers a ×4 bonus: 4 = 640, then +160 per additional**
   (5 = 800, 6 = 960). Points are **deferred and awarded when the sweep reaches the right edge**,
   not at formation/erase time. Soft drop = **+1 pt per cell descended**; hard drop awards no drop
   points.
6. **Combo streaks are Lumines II+, not the 2004 original.** Sustaining 4+ squares across
   successive sweeps chains a streak multiplier (1×/2×/3×/4× labels ≈ ×4/×8/×12/×16 on base) — in
   Lumines II and later only. The original had just the single-sweep ×4 bonus. (Our COMBO_CURVE is
   therefore a legitimate sequel mechanic, but the BASE single-sweep ×4 must exist first.)
7. **Clear-gated music is the ORIGINAL design.** In 2004 Lumines, **if no square was cleared
   during a skin's musical section, that section looped until a square was cleared.** Lumines II
   removed this (music advances regardless). Medium confidence. — i.e. LLMines' clear-gated model
   is faithful to Lumines 1; the autonomous timeline we rejected is the Lumines II behaviour.
8. **Lumines Arise: Burst.** A chargeable gauge (shown above the timeline); activating Burst (1)
   freezes pending matched-square clears so a large same-colour cluster can be built, (2) lifts
   adjacent opposite-colour blocks airborne, (3) on release the frozen clears fire and the lifted
   blocks fall back, landing into new squares for the next pass — a manufactured cascade. Distinct
   from Tetris Effect's Zone (which only freezes). Exact charge thresholds/durations unverified.
9. **Modes (for scope reference).** Classic shipped Challenge (endless skin sequence), Time
   Attack, Puzzle, VS CPU/2P, Skin Edit. Arise adds Journey (story skins), challenge missions, and
   Burst-centric multiplayer. LLMines currently implements a single endless Challenge-like mode.

### Refuted by the verification panel (do NOT implement)

- "40 pts/square ×4 (=160/square) for 4+ squares" — the ×4 applies to the package (640 for 4),
  not linear per-square. Both harddrop's and tetris.wiki's phrasings of linear ×4 were killed 2-1
  and 3-0.
- "A square formed while the timeline is mid-square clears the already-passed portion with no
  points" — killed; the group-batch model above is what's confirmed.
- "Burst is invincibility for one colour with a scaling countdown" (Wikipedia) — killed 0-3.
- The exact Arise grid size per-mode is UNCONFIRMED — don't assume 16×10 holds in Burst Battle.

### Open questions the research couldn't settle

- Chain/bonus-block spawn mechanics in the original (spawn rate, exact flood rules) — our 1-in-14
  rate and orthogonal flood are a deliberate house variant until better data exists.
- Exact Burst meter charge/duration numbers in Arise.
- The full original skin sequence with per-skin BPMs.

### What the deployed LLMines does NOT honour (delta vs this reference)

Beyond the root-cause audit below (hard-drop gem loss A1, snapshot-at-pass-start A2, per-column
erase A3, fixed seed A4, in-field spawn A5, sweep/music BPM decoupling A6, invented scoring A7):

- **D1. No single-sweep ×4 bonus.** We pay 40×squares linearly and bolt a CROSS-pass curve on
  top; real scoring pays 640/800/960 within ONE sweep. The big-clear payoff — the core risk/reward
  of stacking toward a multi-square harvest — is missing.
- **D2. Erase granularity.** Real: mark-on-pass + batch erase per contiguous group at the group's
  end (gravity after the batch). Ours: snapshot at pass start + per-column delete + per-column
  immediate settle. Both halves are wrong in different ways (A2 + A3).
- **D3. Difficulty curve.** Real Lumines derives difficulty from the skin sequence's BPM. Ours
  invents 120→144→168 BPM core "skins" that aren't the music (A6); with only two ~110/~126 BPM
  songs the real curve is flat — needs a deliberate design choice (faster songs, or per-skin
  speed-up variants) rather than the current lie.
- **D4. Piece entry.** Real pieces enter above the field; ours spawn inside rows 0-1 (A5), losing
  ~2 rows of usable height and causing early game over.
- **D5. Single mode, no Burst.** Acceptable scope for now; noted so the gap is a decision, not an
  accident.

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

---

## Known issues

Reported by Rai from playtesting the live build (2026-06-13). **None are fixed yet** — captured verbatim for a future pass. Do not assume any are resolved.

### Gameplay / mechanics
- Gem chaining logic is bad / flawed — often a gem is placed and not enough matching blocks are staged to clear.
- Gems sometimes disappear when placed.
- Game over often happens unexpectedly and prematurely.
- No replay system / game-state record for reproducing issues.

### Audio
- Vocals playing should mean the next segment is auto-queued, but in actual fact the vocals have been heard looping many times — i.e. the intended "vocals revealed → mandatory advance" rule is **not actually advancing** in play.
- "sfx are really really bad and not tied to" — (Rai's note trails off here; SFX quality + the action→SFX mapping both need rework).
- The combined/layered stem doesn't sound like the live mix of the song. The **full-mix master** (source of truth) lives at:
  - song1: `/Users/rai/dev/llmines-audio-build/audio-src/song1/0 Especifico Primero.wav`
  - song2: `/Users/rai/dev/llmines-audio-build/audio-src/song2/0 pipeline male phonk.wav`
  - (also inside `~/Downloads/for florence - skin 1.zip` and `for florence - skin 2.zip` as the `0 *.wav` track; gitignored, not in this repo)

### Skins / progression
- Restarting the game shouldn't restart the current skin — it should start from the **base skin**.
- There's a "toggle skin" button that shouldn't be there / shouldn't work.

### UI
- Score is hidden at the top of the UI.
- Pointless UI element at the bottom of the screen — unclear what the bar is for.
- Pointless "title" button — remove.

### Auth / infra
- Login via Google just doesn't work.

---

## Root-cause audit (2026-06-13, code-verified against deployed `4509c7e`)

Every finding below was verified by reading the deployed code (local HEAD is docs-only on top of
the live deploy). File:line refs are to that state. This maps the Known Issues to their actual
mechanisms and adds divergences-from-Lumines the playtest didn't surface.

### A. Gameplay / game-logic flaws

**A1. Hard drop silently destroys the gem (the "gems disappear when placed" bug).**
`hardDrop` (`src/game/core/piece.ts:393-408`) rebuilds the active piece on each descent step as
`{ cells, pos }` — it drops the `special` field. Move, rotate, and gravity-descent all carefully
carry `special` (each has a comment saying dropping it made the gem vanish), but the hard-drop
loop was missed. Any gem placed with hard drop — the most common placement — locks as a plain
block. Fix: carry `active.special` through the descent loop.

**A2. Squares formed mid-pass ahead of the bar don't clear that pass (the "staged blocks didn't
clear" complaint).** `startPass` (`src/game/core/sweep.ts:24-29`) snapshots marked squares ONCE
when the bar wraps to column 0. A piece locked after that — even far ahead of the bar — is not in
the snapshot, so the bar sweeps straight past a completed square and it waits a full extra
traversal (up to ~8s at 120 BPM). Real Lumines marks squares as the bar reaches them: anything
completed ahead of the bar clears on the current pass. This makes clear timing feel arbitrary.

**A3. Per-column deletion erases half a square before the bar finishes crossing it.**
`processColumn` (`sweep.ts:97-115`) deletes each marked column the instant the leading edge
crosses it and settles that column immediately. Real Lumines erases a marked GROUP only when the
bar passes its right edge, then drops the stack. Visible symptom: squares visibly "peel"
column-by-column and blocks above cascade into the bar mid-square.

**A4. Fixed RNG seed — every game is the same piece sequence.** The controller is constructed
with `seed: 1` and `handleRestart` calls `controller.restart(1)` (`GameShell.tsx:416`,
`controller.ts:239`). Every run of the deployed game deals identical pieces. Also makes the
leaderboard a memorisation contest.

**A5. Premature game over: pieces spawn INSIDE the visible field.** `SPAWN_ROW = 0`
(`constants.ts:17-18`) with game over when the 2×2 can't place at rows 0-1, cols 7-8
(`piece.ts:130-143`). Real Lumines stages the falling piece ABOVE the playfield; the visible
field is fully usable. LLMines effectively forfeits the top two rows of stacking height in the
spawn columns, so the game ends while the board still looks playable — matching "game over often
happens unexpectedly and prematurely".

**A6. Sweep speed is not the music's tempo (core Lumines contract broken).** The sweep BPM comes
from the CORE skin list `src/game/core/skins.ts` (120 → 144 → 168, advancing every
`SKIN_ADVANCE_THRESHOLD = 20` squares) while the audio plays song1 at ~110 BPM or song2 at ~126
BPM (`public/audio/manifest.json`). Two consequences: (1) the timeline bar is NEVER in sync with
the audible music — the defining Lumines coupling; (2) there are TWO unrelated "skin" systems
advancing on unrelated schedules: the core one (sweep speed + `skinIndex` palette, every 20
squares) and the host one (`src/game/skins/skins.ts` NEON/PIPELINE: colour world + soundtrack, on
song completion / the N key). The core skin system looks like a leftover that was never unified
with the v2.5 skin-bundle system.

**A7. Invented scoring constants (pending the mechanics research below).** `COMBO_CURVE = [4, 8,
12, 16]` with `COMBO_MIN_SQUARES = 4` (`constants.ts:65-68`) — a ×4..×16 cross-pass multiplier —
plus `SINGLE_COLOUR_BONUS = 1000`, `ALL_CLEAR_BONUS = 10000`. These are not real Lumines values;
scoring is also banked only at pass completion rather than as groups erase. The mechanics
reference below is the ground truth to re-derive scoring from.

**A8. No replay/game-record system** — confirmed absent (and the fixed seed of A4 would make one
trivially cheap: seed + input log is a full replay).

### B. Audio-engine flaws

**B1. "Clears" are inferred from SCORE DELTAS, so non-clear score events drive the song
(`src/game/audio/procedural/events.ts:63-69`).** The deriver estimates `squares =
max(1, round(delta/40))` from any score increase and always passes `combo: 0`. So: a banked
soft-drop bonus (+N on lock) fires a fake `lineClear` and feeds `segmentScore` with no clear
having happened; a combo-multiplied pass (4 squares × 40 × ×4 = 640) reads as 16 squares; an
all-clear bonus (10,000) reads as 250 squares and slams the advance cap. The clear-gated design
is fed by a proxy that routinely lies in both directions. The engine should be fed real
`(squares, combo)` from the core's pass-completion, not a score diff.

**B2. The "vocals revealed → mandatory advance" rule is structurally dead after the first full
reveal.** `advanceSegment` carries `entryFloor = this.tier` (`engine.ts:1126`), so once one
segment reaches its top tier, EVERY subsequent segment enters at the top — vocals playing from
bar one. But `shouldAdvance` gate (b) (`engine.ts:1082`) requires the top reveal to be EARNED in
the current segment (`segmentScore ≥ top × TIER_REVEAL_STEP`), explicitly excluding carried-in
tops. Result: the steady state of a decent run is "vocals loop indefinitely until the player
grinds out the 30-point clear-gate in every segment" — exactly the reported bug. The carried
floor should cap below the top tier (vocals re-earned per segment), or a carried-in top should
also arm the mandatory advance after one full loop.

**B3. Clears are SILENT by design — the brief's clear-stage sound was cut.**
`play()` (`engine.ts:1183-1191`) returns before SFX routing for `lineClear`/`chain`, and
`sfxRouting.ts` documents "a clear is SILENT by design". The brief explicitly required a
CLEAR-STAGE sound, and a `stage` sample is rendered, shipped in the manifest for both songs, and
never played. The most rewarding moment in the game has no sound.

**B4. Lock thud only fires on hard drops.** The deriver can only see hard-drop locks
(`events.ts:77-87` — documented spike trade-off), so gravity- and soft-drop locks are silent.
`move` is also unmapped (`sfxRouting.ts:31-33`). Net audible SFX: rotate, soft-drop tick,
hard-drop thud — nothing for move, natural lock, clear, or chain. Matches "sfx are really really
bad and not tied to [actions]".

**B5. SFX are not segment-specific, so they sound out of place (Rai's diagnosis, 2026-06-13).**
The manifest carries ONE SFX set per SONG (`songs[].sfx = {drop, move, rotate, softdrop, stage}`),
cut once from the song's ad-libs/palette. Every segment — quiet intro, build, beat-drop, bridge —
fires the same one-shots, so an ad-lib that fits one section clashes with the rest (wrong energy,
wrong texture against the current backing). The fix is per-SEGMENT SFX palettes (cut each
segment's action sounds from that segment's own stems/character, keyed in the manifest alongside
`tiers`), so the action sounds always belong to what's currently playing.
(An earlier draft of this audit flagged the `"@16n"` quantise delay (`engine.ts:1167-1176`) as
the problem — Rai disagreed; the file choice, not the timing, is the issue.)

**B6. The deployed layered mix can't match the full-mix master by construction.** Tier renders
are cumulative stem sums rendered offline; the master (`0 *.wav`) was mixed/mastered as one bus.
If the top tier is to sound like the song, the top tier should BE the master (or the render chain
needs the master-bus processing). Source-of-truth paths are in Known Issues above.

### C. Skins / progression / UI (confirmed mechanisms)

- **Restart keeps the current skin** because the skin id is persisted to localStorage and
  rehydrated (`useSkinSwitch.ts:16,56-64`), and `handleRestart` never resets it. Rai's rule:
  restart → base skin.
- **The "toggle skin" control**: `cycleSkin` is bound to a HUD button and the N key
  (`GameShell.tsx:240-258`). Slated for removal per Known Issues.
- **Game-over music reset works** (`resetForNewGame()` on the game-over edge,
  `GameShell.tsx:215`) — but it resets segments only; the skin/track stays put (see above).
- **Auth**: Google sign-in broken (Known Issues; not yet root-caused — `RealAccountProvider` /
  Convex wiring is the suspect area).
