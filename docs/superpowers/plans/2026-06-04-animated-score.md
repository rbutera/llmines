# Dynamic animated score — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add juicy, impactful score feedback inside the game view — a count-up, pop/scale, floating "+N", particle sparks, and a flash on big clears — while keeping `data-testid="score"` an exact, assertable number.

**Architecture:** Split the authoritative number (the existing `data-testid="score"` HUD element, plain React `score` state — never tweened) from a new cosmetic `ScoreFx` overlay absolutely positioned over the `GameCanvas`. The overlay consumes the `score` prop, detects increases, and fires a transient burst whose count-up carries a separate `data-testid="score-fx"`. Pure tier/tween helpers are unit-tested; the DOM/animation behaviour is covered by e2e.

**Tech Stack:** TypeScript, React 19 (Next.js client components), Tailwind v4 + plain CSS keyframes, Vitest (unit, node env, `globals: false`), Playwright e2e (`NEXT_PUBLIC_TEST_MODE=1`).

**Spec:** `docs/superpowers/specs/2026-06-04-animated-score-design.md`

---

## File Structure

- **Create** `src/game/react/score-fx.ts` — pure, DOM-free helpers: `ScoreTier`, `scoreTier`, `tierParticleCount`, `easeOutCubic`, `tweenValue`, `BURST_MS`. One responsibility: the math/classification behind the juice. Unit-tested.
- **Create** `src/game/react/score-fx.test.ts` — unit tests for those helpers.
- **Create** `src/game/react/ScoreFx.tsx` — the cosmetic overlay component (`"use client"`). Consumes `score`, fires transient bursts. No game logic.
- **Modify** `src/styles/globals.css` — keyframes `score-burst`, `score-gain-rise`, `score-spark`, `score-flash` + reduced-motion guard.
- **Modify** `src/game/react/GameShell.tsx` — `PlayingScreen` wraps `GameCanvas` in a `relative` container and renders `ScoreFx` over it; import `ScoreFx`. The aside `data-testid="score"` stays exactly as-is.
- **Modify** `e2e/lumines.spec.ts` — add a test asserting the burst fires on a scoring event while `score` stays exact.

Context for the implementer (existing code facts):
- `GameShell.tsx` `PlayingScreen({ controller, score })` renders `<GameCanvas controller={controller} />` then an `<aside>` containing `<div data-testid="score" …>{score}</div>`. `score` is React state fed by `controller.subscribe`.
- `GameCanvas` is `<div ref … className="w-full overflow-hidden rounded-xl …" style={{ aspectRatio: "16 / 10" }} />` — the Pixi canvas host.
- `src/styles/globals.css` currently only has `@import "tailwindcss";` and an `@theme` block. Plain CSS appended after works.
- Vitest include is `src/**/*.test.ts` (so `score-fx.test.ts` runs; the `.tsx` component is not unit-tested). Node env, `globals: false` → `import { describe, expect, it } from "vitest";`.
- e2e helpers in `e2e/lumines.spec.ts`: `api(page, fn, ...args)` calls `window.__lumines[fn](...)`; `getState(page)` returns `state()`; `MONO_A` is a mono-colour 2x2. A built mono 2x2 square cleared by `sweepNow` scores 4.

---

### Task 1: Pure score-fx helpers (TDD)

**Files:**
- Create: `src/game/react/score-fx.ts`
- Test: `src/game/react/score-fx.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/game/react/score-fx.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  BURST_MS,
  easeOutCubic,
  scoreTier,
  tierParticleCount,
  tweenValue,
} from "./score-fx";

describe("scoreTier", () => {
  it("classifies by gain magnitude at the 12 and 24 boundaries", () => {
    expect(scoreTier(0)).toBe("small");
    expect(scoreTier(11)).toBe("small");
    expect(scoreTier(12)).toBe("big");
    expect(scoreTier(23)).toBe("big");
    expect(scoreTier(24)).toBe("huge");
    expect(scoreTier(100)).toBe("huge");
  });
});

describe("tierParticleCount", () => {
  it("escalates with tier", () => {
    expect(tierParticleCount("small")).toBe(6);
    expect(tierParticleCount("big")).toBe(12);
    expect(tierParticleCount("huge")).toBe(20);
  });
});

describe("easeOutCubic", () => {
  it("maps endpoints and clamps out-of-range t", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });

  it("is monotonic increasing", () => {
    expect(easeOutCubic(0.25)).toBeLessThan(easeOutCubic(0.75));
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6);
  });
});

describe("tweenValue", () => {
  it("returns from at t=0 and to at t=1", () => {
    expect(tweenValue(0, 8, 0)).toBe(0);
    expect(tweenValue(0, 8, 1)).toBe(8);
  });

  it("eases toward the target (eased midpoint)", () => {
    // easeOutCubic(0.5) = 0.875 -> 0 + 8*0.875 = 7
    expect(tweenValue(0, 8, 0.5)).toBeCloseTo(7, 6);
  });
});

describe("BURST_MS", () => {
  it("is a positive duration", () => {
    expect(BURST_MS).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/react/score-fx.test.ts`
Expected: FAIL — `Cannot find module './score-fx'`.

- [x] **Step 3: Write the helpers**

Create `src/game/react/score-fx.ts`:

```typescript
/** Pure helpers behind the cosmetic score animation. No React / DOM. */

/** Magnitude tier for a single scoring event, by points gained. */
export type ScoreTier = "small" | "big" | "huge";

/** Lifetime of one score burst, in ms (count-up + particles + flash). */
export const BURST_MS = 1200;

/** Classify a gain: huge >= 24, big >= 12, else small. */
export function scoreTier(gain: number): ScoreTier {
  if (gain >= 24) return "huge";
  if (gain >= 12) return "big";
  return "small";
}

/** How many spark particles to emit for a tier. */
export function tierParticleCount(tier: ScoreTier): number {
  if (tier === "huge") return 20;
  if (tier === "big") return 12;
  return 6;
}

/** Ease-out cubic on a clamped t in [0, 1]. */
export function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Eased interpolation from `from` to `to` at progress `t` (clamped). */
export function tweenValue(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutCubic(t);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/game/react/score-fx.test.ts`
Expected: PASS — all assertions green.

- [x] **Step 5: Commit**

```bash
git add src/game/react/score-fx.ts src/game/react/score-fx.test.ts
git commit -m "feat: add pure score-fx tier/tween helpers"
```

---

### Task 2: The ScoreFx overlay component + CSS keyframes

**Files:**
- Create: `src/game/react/ScoreFx.tsx`
- Modify: `src/styles/globals.css`

No unit test (visual/DOM behaviour is covered by the e2e in Task 4). Verified here by typecheck + lint.

- [x] **Step 1: Add the keyframes to globals.css**

Append to `src/styles/globals.css`:

```css
/* ---- Animated score (ScoreFx overlay) ---------------------------------- */

.score-fx-value {
  animation: score-burst 650ms cubic-bezier(0.2, 1.4, 0.3, 1) both;
}
@keyframes score-burst {
  0% {
    transform: scale(0.6);
  }
  40% {
    transform: scale(1.25);
  }
  100% {
    transform: scale(1);
  }
}

.score-fx-chip {
  animation: score-gain-rise 1100ms ease-out both;
}
@keyframes score-gain-rise {
  0% {
    transform: translateY(0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  100% {
    transform: translateY(-64px);
    opacity: 0;
  }
}

.score-fx-spark {
  animation: score-spark 900ms ease-out both;
}
@keyframes score-spark {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(var(--spark-x), var(--spark-y)) scale(0.3);
    opacity: 0;
  }
}

.score-fx-flash {
  animation: score-flash 600ms ease-out both;
}
@keyframes score-flash {
  0% {
    opacity: 0;
  }
  25% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .score-fx-value,
  .score-fx-chip,
  .score-fx-spark,
  .score-fx-flash {
    animation-duration: 1ms;
  }
}
```

- [x] **Step 2: Create the overlay component**

Create `src/game/react/ScoreFx.tsx`:

```tsx
"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  BURST_MS,
  scoreTier,
  tierParticleCount,
  tweenValue,
  type ScoreTier,
} from "./score-fx";

const COLOR_A = "#37e0c9"; // cyan
const COLOR_B = "#ff5fb0"; // magenta
const COUNT_UP_MS = 650;

interface Burst {
  id: number;
  gain: number;
  tier: ScoreTier;
  particles: number[];
}

/**
 * Cosmetic, decorative score juice layered over the board. The authoritative
 * value lives elsewhere (the HUD `data-testid="score"`); this overlay only
 * reacts to increases of the `score` prop and never feeds anything back.
 */
export function ScoreFx({ score }: { score: number }) {
  const prevScore = useRef(score);
  const [display, setDisplay] = useState(score);
  const [visible, setVisible] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const rafRef = useRef<number | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const prev = prevScore.current;
    prevScore.current = score;
    if (score <= prev) {
      // Reset / restart (score dropped to 0): snap, no burst.
      setDisplay(score);
      setVisible(false);
      return;
    }

    const gain = score - prev;
    const tier = scoreTier(gain);
    const reduced =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Count-up tween prev -> score on the score-fx element.
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setVisible(true);
    if (reduced) {
      setDisplay(score);
    } else {
      let startTs = 0;
      const step = (ts: number) => {
        if (startTs === 0) startTs = ts;
        const t = Math.min(1, (ts - startTs) / COUNT_UP_MS);
        setDisplay(Math.round(tweenValue(prev, score, t)));
        if (t < 1) rafRef.current = requestAnimationFrame(step);
        else rafRef.current = null;
      };
      rafRef.current = requestAnimationFrame(step);
    }

    // Burst: +N chip, sparks, and a flash for big/huge tiers.
    const id = ++idRef.current;
    const count = reduced ? 0 : tierParticleCount(tier);
    const particles = Array.from({ length: count }, (_, i) => i);
    setBursts((bs) => [...bs, { id, gain, tier, particles }]);
    const burstTimer = setTimeout(() => {
      setBursts((bs) => bs.filter((b) => b.id !== id));
    }, BURST_MS);

    // Hide the count-up after the burst settles.
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setVisible(false), BURST_MS);

    return () => clearTimeout(burstTimer);
  }, [score]);

  // Cancel pending rAF / timers on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  const latest = bursts[bursts.length - 1];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {visible && (
        <div className="absolute inset-x-0 top-6 flex justify-center">
          <span
            key={latest ? latest.id : "idle"}
            data-testid="score-fx"
            className="score-fx-value font-mono text-6xl font-black tabular-nums text-white"
            style={{ textShadow: `0 0 24px ${COLOR_A}, 0 0 48px ${COLOR_B}` }}
          >
            {display}
          </span>
        </div>
      )}

      {bursts.map((b) => (
        <div key={b.id} className="absolute inset-0">
          {b.tier !== "small" && (
            <div
              className="score-fx-flash absolute inset-0"
              style={{
                background:
                  b.tier === "huge"
                    ? "radial-gradient(circle, rgba(255,95,176,0.40), transparent 70%)"
                    : "radial-gradient(circle, rgba(55,224,201,0.30), transparent 70%)",
              }}
            />
          )}

          <div className="absolute inset-x-0 top-24 flex justify-center">
            <span
              className="score-fx-chip font-mono text-2xl font-black"
              style={{ color: b.tier === "huge" ? COLOR_B : COLOR_A }}
            >
              +{b.gain}
            </span>
          </div>

          <div className="absolute top-1/3 left-1/2">
            {b.particles.map((i) => {
              const angle = (360 / b.particles.length) * i;
              const dist =
                60 + (b.tier === "huge" ? 80 : b.tier === "big" ? 40 : 0);
              return (
                <span
                  key={i}
                  className="score-fx-spark absolute block h-2 w-2 rounded-full"
                  style={
                    {
                      background: i % 2 === 0 ? COLOR_A : COLOR_B,
                      "--spark-x": `${Math.cos((angle * Math.PI) / 180) * dist}px`,
                      "--spark-y": `${Math.sin((angle * Math.PI) / 180) * dist}px`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [x] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` then `npx next lint`
Expected: `tsc` exit 0; "No ESLint warnings or errors". (The `as CSSProperties` cast is required because `--spark-x`/`--spark-y` are CSS custom properties.)

- [x] **Step 4: Commit**

```bash
git add src/game/react/ScoreFx.tsx src/styles/globals.css
git commit -m "feat: add ScoreFx overlay component and juice keyframes"
```

---

### Task 3: Wire ScoreFx over the canvas in PlayingScreen

**Files:**
- Modify: `src/game/react/GameShell.tsx`

- [x] **Step 1: Import ScoreFx**

In `src/game/react/GameShell.tsx`, add this import next to the other local imports (after the `GameCanvas` import):

```tsx
import { ScoreFx } from "./ScoreFx";
```

- [x] **Step 2: Wrap the canvas and overlay the juice**

In `PlayingScreen`, replace the bare `<GameCanvas controller={controller} />` line with a relative wrapper containing the canvas and the overlay:

```tsx
      <div className="relative">
        <GameCanvas controller={controller} />
        <ScoreFx score={score} />
      </div>
```

The `<aside>` block with `data-testid="score"` stays exactly as it is (authoritative, exact value).

- [x] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` then `npx next lint`
Expected: `tsc` exit 0; "No ESLint warnings or errors".

- [x] **Step 4: Commit**

```bash
git add src/game/react/GameShell.tsx
git commit -m "feat: overlay ScoreFx on the game canvas"
```

---

### Task 4: e2e — the burst fires, the value stays exact

**Files:**
- Modify: `e2e/lumines.spec.ts`

- [x] **Step 1: Add the test**

Add this test at the end of `e2e/lumines.spec.ts`:

```typescript
test("scoring fires an in-view animation while score stays exact", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  // Build a mono 2x2 on the floor, then sweep to score 4.
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "sweepNow");

  // The juice element appears in the game view...
  await expect(page.getByTestId("score-fx")).toBeVisible();
  // ...and the authoritative score is exact and assertable.
  await expect(page.getByTestId("score")).toHaveText("4");

  // The burst is transient: the cosmetic element clears, value remains.
  await expect(page.getByTestId("score-fx")).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveText("4");
});
```

- [x] **Step 2: Run the e2e suite**

Run: `npx playwright test`
Expected: PASS — all tests green (the 11 existing + this new one). The existing "a built 2x2 square is cleared by the sweep" test still asserts `score` = "4" and stays green (the authoritative element is unchanged).

- [x] **Step 3: Commit**

```bash
git add e2e/lumines.spec.ts
git commit -m "test: e2e for animated score burst with exact value"
```

---

### Task 5: Full verification sweep

- [x] **Step 1: Run everything**

Run, in order:
- `npx vitest run` — Expected: all unit suites green (core, hold, fall-progress, controller, score-fx).
- `npx tsc --noEmit` — Expected: exit 0.
- `npx next lint` — Expected: "No ESLint warnings or errors".
- `npx prettier --write "src/**/*.{ts,tsx}" "e2e/**/*.ts"` then `npx prettier --check "src/**/*.{ts,tsx}" "e2e/**/*.ts"` — Expected: formatted / all pass.
- `npx playwright test` — Expected: all e2e green.

- [x] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore: format animated score changes" || echo "nothing to format"
```

---

## Self-Review

**1. Spec coverage:**
- Authoritative `data-testid="score"` stays exact → Task 3 keeps the aside untouched; never tweened. ✓
- Cosmetic overlay over the game view with count-up/pop/+N/particles/flash → Task 2 `ScoreFx` + Task 1 helpers + Task 3 wiring. ✓
- Separate `data-testid="score-fx"` for the count-up → Task 2 component; asserted in Task 4. ✓
- Tiers at 12/24 with escalating particles + flash on big/huge → Task 1 `scoreTier`/`tierParticleCount`, Task 2 flash gating. ✓
- Reduced motion → Task 2 `matchMedia` guard + Task 2 Step 1 media query. ✓
- Testability (value assertable, animation must not break it) → Task 4 asserts both `score-fx` visible and `score` exact "4". ✓
- No regression → core/controller/renderer untouched; existing score assertions intact (Task 4 Step 2 note). ✓

**2. Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code with exact commands and expected output.

**3. Type consistency:** `ScoreTier` ("small"|"big"|"huge"), `scoreTier`, `tierParticleCount`, `easeOutCubic`, `tweenValue`, `BURST_MS` are defined in Task 1 and used identically in Task 1's test and Task 2's component. `ScoreFx` takes `{ score: number }` (Task 2) and is rendered with `score={score}` (Task 3). `data-testid="score-fx"` (Task 2) matches the e2e queries (Task 4).
