# Accounts + Convex leaderboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google accounts (NextAuth), persistent personal-best scores, and a global top-10 leaderboard backed by Convex — built mock-first so the same code runs against a deterministic mock (eval) and a real Convex deployment (later) with no rewrite, never touching a live backend.

**Architecture:** One Convex table + functions (`submitScore`/`topN`/`personalBest`, user derived server-side from `ctx.auth`). A React **provider seam** (`AccountProvider`) swaps `MockAccountProvider` (TEST_MODE, in-memory store + `window.__lumines` hooks) vs `RealAccountProvider` (NextAuth + Convex) behind shared `useAuth()`/`useScores()` contexts. `convex/_generated/` is hand-written + committed; functions are tested with `convex-test`; the mock + DOM are tested via e2e.

**Tech Stack:** convex@1.40, convex-test@0.0.53, next-auth@5 (beta), React 19 / Next 15, Vitest (node), Playwright (`NEXT_PUBLIC_TEST_MODE=1`). **Do NOT run `convex dev/deploy/login`.**

**Spec:** `docs/superpowers/specs/2026-06-04-accounts-leaderboard-design.md`

---

## File Structure

- **Modify** `package.json` / `pnpm-lock.yaml` — add `convex`, `next-auth` (deps), `convex-test` (dev). (Already installed in the working tree.)
- **Modify** `src/env.js` — optional `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXT_PUBLIC_CONVEX_URL`.
- **Create** `convex/schema.ts` — `scores` table + indexes.
- **Create** `convex/scores.ts` — `submitScore`, `topN`, `personalBest`.
- **Create** `convex/scores.test.ts` — convex-test in-memory tests.
- **Create** `convex/tsconfig.json` — convex dir compile scope (for the CLI; root tsc also compiles it).
- **Create** `convex/test-env.d.ts` — ambient `ImportMeta.glob` typing.
- **Create** `convex/_generated/{api.js,api.d.ts,server.js,server.d.ts,dataModel.d.ts}` — hand-written, committed.
- **Modify** `vitest.config.ts` — include `convex/**/*.test.ts`; inline `convex-test`.
- **Create** `src/game/account/types.ts` — `AuthUser`, `AuthApi`, `LeaderboardEntry`, `ScoresApi`.
- **Create** `src/game/account/context.tsx` — contexts + `useAuth`/`useScores`.
- **Create** `src/game/account/mock-store.ts` — pure in-memory store.
- **Create** `src/game/account/mock-store.test.ts` — unit tests.
- **Create** `src/game/account/MockAccountProvider.tsx` — TEST_MODE provider + `window.__lumines.auth`.
- **Create** `src/game/account/RealAccountProvider.tsx` — NextAuth + Convex provider (compiles; not run in eval).
- **Create** `src/game/account/AccountProvider.tsx` — TEST_MODE swap.
- **Create** `src/server/auth.ts` — NextAuth config.
- **Create** `src/app/api/auth/[...nextauth]/route.ts` — auth route handlers.
- **Create** `src/game/react/AccountBar.tsx`, `Leaderboard.tsx`, `PersonalBest.tsx` — UI with testids.
- **Modify** `src/game/engine/controller.ts` — `testEndGame(score)`.
- **Modify** `src/game/test-api/install.ts` — `endGame` hook (merge into `window.__lumines`).
- **Modify** `src/game/react/GameShell.tsx` — wrap in `AccountProvider`; AccountBar; submit-on-gameover effect; leaderboard + personal-best placement.
- **Create** `e2e/leaderboard.spec.ts` — black-box auth + score-submit tests.

Context facts (verified in this cell):
- Root `tsconfig.json`: `moduleResolution: "Bundler"`, `checkJs: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`, includes `**/*.ts(x)` and `e2e/**`, excludes only `node_modules`/`generated`. So `_generated/*.js` ARE type-checked (keep them clean) and e2e is type-checked (keep its `Window.__lumines` in sync with `install.ts`).
- `convex/server` exports `queryGeneric`/`mutationGeneric`/`actionGeneric`/`httpActionGeneric`/`internal*Generic`/`anyApi` (runtime) and the `*Builder`/`Generic*Ctx`/`DataModelFromSchemaDefinition` types.
- `convex-test` exports `convexTest`.
- `GameShell.tsx`: `score` is React state from `controller.subscribe`; subscribe sets `phase="gameover"` only when `rs.gameOver && phaseRef.current==="playing"`. `install.ts` currently does `window.__lumines = api` then a matching cleanup.
- Vitest: node env, `globals:false` → `import { describe, expect, it } from "vitest";`.

---

### Task 1: Dependencies, env, and hand-written `convex/_generated`

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (already done by install)
- Modify: `src/env.js`
- Create: `convex/tsconfig.json`, `convex/test-env.d.ts`
- Create: `convex/_generated/api.js`, `api.d.ts`, `server.js`, `server.d.ts`, `dataModel.d.ts`

- [x] **Step 1: Confirm deps are installed**

Run: `node -e "console.log(require('convex/package.json').version, require('convex-test/package.json').version, require('next-auth/package.json').version)"`
Expected: `1.40.0 0.0.53 5.0.0-beta.31` (if missing: `pnpm add convex next-auth && pnpm add -D convex-test`).

- [x] **Step 2: Add optional auth/convex env vars**

In `src/env.js`, extend the `server` block (after `NODE_ENV`):

```js
    NODE_ENV: z.enum(["development", "test", "production"]),
    AUTH_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
```

Extend the `client` block (after `NEXT_PUBLIC_TEST_MODE`):

```js
    NEXT_PUBLIC_TEST_MODE: z.enum(["0", "1"]).optional(),
    NEXT_PUBLIC_CONVEX_URL: z.string().url().optional(),
```

Extend `runtimeEnv`:

```js
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_TEST_MODE: process.env.NEXT_PUBLIC_TEST_MODE,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
```

- [x] **Step 3: Hand-write `convex/_generated/`** (codegen needs a deploy key offline; these mirror convex@1.40 output)

Create `convex/_generated/api.js`:

```js
/* eslint-disable */
/**
 * Generated `api` utility. Hand-written for offline/eval use (mirrors
 * `convex codegen` output for convex@1.40). Do not edit by hand otherwise.
 */
import { anyApi } from "convex/server";

export const api = anyApi;
export const internal = anyApi;
```

Create `convex/_generated/api.d.ts`:

```ts
/* eslint-disable */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as scores from "../scores.js";

declare const fullApi: ApiFromModules<{
  scores: typeof scores;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
```

Create `convex/_generated/server.js`:

```js
/* eslint-disable */
import {
  actionGeneric,
  httpActionGeneric,
  queryGeneric,
  mutationGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";

export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;
```

Create `convex/_generated/server.d.ts`:

```ts
/* eslint-disable */
import type {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

export declare const query: QueryBuilder<DataModel, "public">;
export declare const internalQuery: QueryBuilder<DataModel, "internal">;
export declare const mutation: MutationBuilder<DataModel, "public">;
export declare const internalMutation: MutationBuilder<DataModel, "internal">;
export declare const action: ActionBuilder<DataModel, "public">;
export declare const internalAction: ActionBuilder<DataModel, "internal">;
export declare const httpAction: HttpActionBuilder;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
```

Create `convex/_generated/dataModel.d.ts`:

```ts
/* eslint-disable */
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import type schema from "../schema.js";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type Doc<TableName extends TableNamesInDataModel<DataModel>> =
  DocumentByName<DataModel, TableName>;
export type Id<
  TableName extends TableNamesInDataModel<DataModel> | SystemTableNames,
> = GenericId<TableName>;
```

- [x] **Step 4: Convex tsconfig + glob typing**

Create `convex/tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "strict": true,
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ESNext",
    "lib": ["ES2021", "dom"],
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
```

Create `convex/test-env.d.ts`:

```ts
// Ambient typing for Vite's `import.meta.glob` used by convex-test, without
// depending on `vite/client` resolving under pnpm.
interface ImportMeta {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}
```

- [x] **Step 5: Typecheck the scaffold (schema/functions not present yet → expect errors only about missing `../schema`/`../scores`)**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: errors referencing `../schema.js` / `../scores.js` not found (resolved in Task 2). No syntax errors in `_generated`. (This step just sanity-checks the generated files parse; it goes green at the end of Task 2.)

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/env.js convex/tsconfig.json convex/test-env.d.ts convex/_generated
git commit -m "chore: add convex/next-auth deps, env, hand-written convex/_generated"
```

---

### Task 2: Convex schema + functions (TDD via convex-test)

**Files:**
- Create: `convex/schema.ts`, `convex/scores.ts`, `convex/scores.test.ts`
- Modify: `vitest.config.ts`

- [x] **Step 1: Wire vitest for convex-test**

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Logic core is pure; convex-test runs the real backend in-memory (node).
    environment: "node",
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
    globals: false,
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

- [x] **Step 2: Write the failing convex-test**

Create `convex/scores.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("convex/scores", () => {
  it("submitScore is a no-op when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(api.scores.submitScore, { score: 100 })).toBe(null);
    expect(await t.query(api.scores.topN, {})).toEqual([]);
  });

  it("derives the player from identity; personal best only rises", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", name: "Alice" });
    expect(await alice.mutation(api.scores.submitScore, { score: 100 })).toBe(100);
    expect(await alice.mutation(api.scores.submitScore, { score: 40 })).toBe(100);
    expect(await alice.mutation(api.scores.submitScore, { score: 250 })).toBe(250);
    expect(await alice.query(api.scores.personalBest, {})).toBe(250);
  });

  it("keeps identities isolated (server-derived subject)", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity({ subject: "a", name: "A" }).mutation(api.scores.submitScore, { score: 10 });
    await t.withIdentity({ subject: "b", name: "B" }).mutation(api.scores.submitScore, { score: 20 });
    expect(await t.withIdentity({ subject: "a", name: "A" }).query(api.scores.personalBest, {})).toBe(10);
    expect(await t.withIdentity({ subject: "b", name: "B" }).query(api.scores.personalBest, {})).toBe(20);
  });

  it("topN returns entries by best descending", async () => {
    const t = convexTest(schema, modules);
    const rows: [string, number][] = [["a", 10], ["b", 30], ["c", 20]];
    for (const [s, n] of rows) {
      await t.withIdentity({ subject: s, name: s }).mutation(api.scores.submitScore, { score: n });
    }
    const top = await t.query(api.scores.topN, { n: 2 });
    expect(top.map((r) => r.best)).toEqual([30, 20]);
    expect(top[0]!.name).toBe("b");
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx vitest run convex/scores.test.ts`
Expected: FAIL — `Cannot find module './schema'` (schema/functions not written yet).

- [x] **Step 4: Write the schema**

Create `convex/schema.ts`:

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scores: defineTable({
    // `subject` is the stable identity id derived server-side from
    // ctx.auth.getUserIdentity(); never a client argument.
    subject: v.string(),
    name: v.string(),
    best: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best", ["best"]),
});
```

- [x] **Step 5: Write the functions**

Create `convex/scores.ts`:

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_TOP_N = 10;

/**
 * Persist a finished run's score for the AUTHENTICATED user. The player is
 * derived from `ctx.auth.getUserIdentity()` server-side — never trusted from a
 * client argument. Unauthenticated calls are a no-op (returns null). The stored
 * row keeps the personal best, updated only when strictly beaten.
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const subject = identity.subject;
    const name = identity.name ?? "Player";
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (existing === null) {
      await ctx.db.insert("scores", { subject, name, best: score });
      return score;
    }
    if (score > existing.best) {
      await ctx.db.patch(existing._id, { best: score, name });
      return score;
    }
    return existing.best;
  },
});

/** The signed-in user's personal best, or null if unauthenticated / no runs. */
export const personalBest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return row?.best ?? null;
  },
});

/** Global leaderboard: top `n` (default 10) personal bests, descending. */
export const topN = query({
  args: { n: v.optional(v.number()) },
  handler: async (ctx, { n }) => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(n ?? DEFAULT_TOP_N);
    return rows.map((r) => ({ subject: r.subject, name: r.name, best: r.best }));
  },
});
```

- [x] **Step 6: Run it to verify it passes**

Run: `npx vitest run convex/scores.test.ts`
Expected: PASS — 4 tests. (If convex-test errors about environment, the node env + `server.deps.inline:["convex-test"]` from Step 1 is required; re-confirm that edit landed.)

- [x] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (the `_generated` files now resolve `../schema`/`../scores`).

- [x] **Step 8: Commit**

```bash
git add convex/schema.ts convex/scores.ts convex/scores.test.ts vitest.config.ts
git commit -m "feat: convex scores schema + submitScore/topN/personalBest (convex-test green)"
```

---

### Task 3: Pure mock store (TDD)

**Files:**
- Create: `src/game/account/types.ts`, `src/game/account/mock-store.ts`, `src/game/account/mock-store.test.ts`

- [x] **Step 1: Write the types**

Create `src/game/account/types.ts`:

```ts
/** Account + leaderboard contract shared by the mock (eval) and real providers. */

export interface AuthUser {
  /** Stable server-derived identity id. */
  subject: string;
  name: string;
  image?: string | null;
}

export interface AuthApi {
  user: AuthUser | null;
  signIn: () => void;
  signOut: () => void;
}

export interface LeaderboardEntry {
  subject: string;
  name: string;
  best: number;
}

export interface ScoresApi {
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  submitScore: (score: number) => void;
}
```

- [x] **Step 2: Write the failing test**

Create `src/game/account/mock-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MockStore } from "./mock-store";

describe("MockStore", () => {
  it("submit is a no-op when unauthenticated", () => {
    const s = new MockStore();
    expect(s.submit(null, 100)).toBe(null);
    expect(s.topN()).toEqual([]);
    expect(s.personalBest(null)).toBe(null);
  });

  it("keeps personal best, only rising", () => {
    const s = new MockStore();
    const me = { subject: "me", name: "Me" };
    expect(s.submit(me, 100)).toBe(100);
    expect(s.submit(me, 40)).toBe(100);
    expect(s.submit(me, 250)).toBe(250);
    expect(s.personalBest("me")).toBe(250);
  });

  it("isolates identities by subject", () => {
    const s = new MockStore();
    s.submit({ subject: "a", name: "A" }, 10);
    s.submit({ subject: "b", name: "B" }, 20);
    expect(s.personalBest("a")).toBe(10);
    expect(s.personalBest("b")).toBe(20);
  });

  it("topN returns best descending, capped at n", () => {
    const s = new MockStore();
    s.submit({ subject: "a", name: "A" }, 10);
    s.submit({ subject: "b", name: "B" }, 30);
    s.submit({ subject: "c", name: "C" }, 20);
    expect(s.topN(2).map((r) => r.best)).toEqual([30, 20]);
    expect(s.topN(2).map((r) => r.name)).toEqual(["B", "C"]);
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/game/account/mock-store.test.ts`
Expected: FAIL — `Cannot find module './mock-store'`.

- [x] **Step 4: Write the store** (mirrors `convex/scores.ts` exactly)

Create `src/game/account/mock-store.ts`:

```ts
import type { LeaderboardEntry } from "./types";

export interface MockIdentity {
  subject: string;
  name: string;
}

/**
 * In-memory mirror of `convex/scores.ts` for TEST_MODE. One row per subject;
 * unauthenticated submit is a no-op; personal best only rises. Pure + sync.
 */
export class MockStore {
  private readonly rows = new Map<string, LeaderboardEntry>();

  submit(identity: MockIdentity | null, score: number): number | null {
    if (!identity) return null;
    const existing = this.rows.get(identity.subject);
    if (!existing) {
      this.rows.set(identity.subject, {
        subject: identity.subject,
        name: identity.name,
        best: score,
      });
      return score;
    }
    if (score > existing.best) {
      existing.best = score;
      existing.name = identity.name;
    }
    return existing.best;
  }

  personalBest(subject: string | null): number | null {
    if (!subject) return null;
    return this.rows.get(subject)?.best ?? null;
  }

  topN(n = 10): LeaderboardEntry[] {
    return [...this.rows.values()]
      .sort((a, b) => b.best - a.best)
      .slice(0, n)
      .map((r) => ({ ...r }));
  }
}
```

- [x] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/game/account/mock-store.test.ts`
Expected: PASS — 4 tests.

- [x] **Step 6: Commit**

```bash
git add src/game/account/types.ts src/game/account/mock-store.ts src/game/account/mock-store.test.ts
git commit -m "feat: account types + pure MockStore (mirrors convex/scores)"
```

---

### Task 4: Account contexts + providers (seam)

**Files:**
- Create: `src/game/account/context.tsx`, `MockAccountProvider.tsx`, `RealAccountProvider.tsx`, `AccountProvider.tsx`

No new unit test — exercised by e2e (Task 8). Verified here by typecheck + lint.

- [x] **Step 1: Contexts + hooks**

Create `src/game/account/context.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { AuthApi, ScoresApi } from "./types";

export const AuthContext = createContext<AuthApi | null>(null);
export const ScoresContext = createContext<ScoresApi | null>(null);

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within an AccountProvider");
  return value;
}

export function useScores(): ScoresApi {
  const value = useContext(ScoresContext);
  if (!value) throw new Error("useScores must be used within an AccountProvider");
  return value;
}
```

- [x] **Step 2: Mock provider (+ window seam)**

Create `src/game/account/MockAccountProvider.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthContext, ScoresContext } from "./context";
import { MockStore } from "./mock-store";
import type { AuthUser, LeaderboardEntry } from "./types";

/**
 * TEST_MODE account provider: an in-memory MockStore behind the same contexts
 * as the real provider, plus the deterministic `window.__lumines.auth` seam so
 * the e2e harness can sign in/out without a real OAuth round-trip.
 */
export function MockAccountProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<MockStore | null>(null);
  storeRef.current ??= new MockStore();
  const store = storeRef.current;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const refresh = useCallback(
    (current: AuthUser | null) => {
      setPersonalBest(store.personalBest(current?.subject ?? null));
      setLeaderboard(store.topN(10));
    },
    [store],
  );

  const signInAs = useCallback(
    (u: AuthUser) => {
      setUser(u);
      refresh(u);
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setUser(null);
    refresh(null);
  }, [refresh]);

  // Mock mode has no real Google SSO; the visible button signs in a demo user.
  const signIn = useCallback(() => {
    signInAs({ subject: "demo", name: "Demo Player" });
  }, [signInAs]);

  const submitScore = useCallback(
    (score: number) => {
      store.submit(user ? { subject: user.subject, name: user.name } : null, score);
      refresh(user);
    },
    [store, user, refresh],
  );

  useEffect(() => {
    const w = window as unknown as { __lumines?: Record<string, unknown> };
    w.__lumines = {
      ...(w.__lumines ?? {}),
      auth: {
        signIn: (id: { name: string; subject: string }) =>
          signInAs({ subject: id.subject, name: id.name }),
        signOut,
      },
    };
  }, [signInAs, signOut]);

  const authApi = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  const scoresApi = useMemo(
    () => ({ personalBest, leaderboard, submitScore }),
    [personalBest, leaderboard, submitScore],
  );

  return (
    <AuthContext.Provider value={authApi}>
      <ScoresContext.Provider value={scoresApi}>{children}</ScoresContext.Provider>
    </AuthContext.Provider>
  );
}
```

- [x] **Step 3: Real provider (compiles; not run in eval)**

Create `src/game/account/RealAccountProvider.tsx`:

```tsx
"use client";

import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import {
  SessionProvider,
  signIn as nextSignIn,
  signOut as nextSignOut,
  useSession,
} from "next-auth/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { env } from "~/env";
import { AuthContext, ScoresContext } from "./context";
import type { LeaderboardEntry } from "./types";

/**
 * Production provider: NextAuth session + Convex queries/mutations behind the
 * same contexts as the mock. NOTE: the live NextAuth->Convex token bridge
 * (`ConvexProviderWithAuth`) is wired in the real production pass; here we use a
 * plain ConvexProvider so the module compiles offline. Not mounted in TEST_MODE.
 */
function AuthBridge({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const user = session?.user
    ? {
        subject: session.user.email ?? session.user.name ?? "user",
        name: session.user.name ?? "Player",
        image: session.user.image,
      }
    : null;
  const authApi = useMemo(
    () => ({
      user,
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
    }),
    [user],
  );
  return <AuthContext.Provider value={authApi}>{children}</AuthContext.Provider>;
}

function ScoresBridge({ children }: { children: ReactNode }) {
  const leaderboard: LeaderboardEntry[] = useQuery(api.scores.topN, {}) ?? [];
  const personalBest = useQuery(api.scores.personalBest, {}) ?? null;
  const submit = useMutation(api.scores.submitScore);
  const submitScore = useCallback((score: number) => void submit({ score }), [submit]);
  const scoresApi = useMemo(
    () => ({ personalBest, leaderboard, submitScore }),
    [personalBest, leaderboard, submitScore],
  );
  return <ScoresContext.Provider value={scoresApi}>{children}</ScoresContext.Provider>;
}

export function RealAccountProvider({ children }: { children: ReactNode }) {
  // Constructed lazily so importing this module in TEST_MODE touches no network.
  const [client] = useState(
    () => new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL ?? "https://example.convex.cloud"),
  );
  return (
    <SessionProvider>
      <ConvexProvider client={client}>
        <AuthBridge>
          <ScoresBridge>{children}</ScoresBridge>
        </AuthBridge>
      </ConvexProvider>
    </SessionProvider>
  );
}
```

- [x] **Step 4: The swap**

Create `src/game/account/AccountProvider.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { TEST_MODE } from "../test-api/flag";
import { MockAccountProvider } from "./MockAccountProvider";
import { RealAccountProvider } from "./RealAccountProvider";

/** Swaps the deterministic mock (TEST_MODE) for the real NextAuth+Convex stack. */
export function AccountProvider({ children }: { children: ReactNode }) {
  return TEST_MODE ? (
    <MockAccountProvider>{children}</MockAccountProvider>
  ) : (
    <RealAccountProvider>{children}</RealAccountProvider>
  );
}
```

- [x] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` then `npx next lint`
Expected: `tsc` exit 0; "No ESLint warnings or errors". (If `next-auth/react`'s `session.user` typing complains, the optional chaining above guards it; if `useQuery` generic inference needs help it is already typed via `?? []`/`?? null`.)

- [x] **Step 6: Commit**

```bash
git add src/game/account/context.tsx src/game/account/MockAccountProvider.tsx src/game/account/RealAccountProvider.tsx src/game/account/AccountProvider.tsx
git commit -m "feat: account provider seam (mock + real) behind shared contexts"
```

---

### Task 5: NextAuth config + route

**Files:**
- Create: `src/server/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`

- [x] **Step 1: NextAuth config**

Create `src/server/auth.ts`:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "~/env";

/**
 * NextAuth (Auth.js v5) with Google SSO. Credentials are optional env vars so
 * the app builds without them in eval; the real values are supplied in the
 * production pass. Exercised only in the non-TEST_MODE (real) provider.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    }),
  ],
  secret: env.AUTH_SECRET,
});
```

- [x] **Step 2: Route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "~/server/auth";

export const { GET, POST } = handlers;
```

- [x] **Step 3: Typecheck + build smoke (route compiles)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [x] **Step 4: Commit**

```bash
git add src/server/auth.ts "src/app/api/auth/[...nextauth]/route.ts"
git commit -m "feat: NextAuth (Google) config + route handler"
```

---

### Task 6: UI components (testids)

**Files:**
- Create: `src/game/react/AccountBar.tsx`, `Leaderboard.tsx`, `PersonalBest.tsx`

- [x] **Step 1: AccountBar**

Create `src/game/react/AccountBar.tsx`:

```tsx
"use client";

import { useAuth } from "../account/context";

/** Sign-in / signed-in identity strip. Testids: signin, user-name, signout. */
export function AccountBar() {
  const { user, signIn, signOut } = useAuth();

  if (!user) {
    return (
      <button
        data-testid="signin"
        onClick={signIn}
        className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" className="h-8 w-8 rounded-full" />
      ) : null}
      <span data-testid="user-name" className="text-sm font-semibold text-white">
        {user.name}
      </span>
      <button
        data-testid="signout"
        onClick={signOut}
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
      >
        Sign out
      </button>
    </div>
  );
}
```

- [x] **Step 2: Leaderboard**

Create `src/game/react/Leaderboard.tsx`:

```tsx
"use client";

import { useScores } from "../account/context";

/** Global top-10. Testids: leaderboard (container), leaderboard-row (per entry). */
export function Leaderboard() {
  const { leaderboard } = useScores();
  return (
    <div
      data-testid="leaderboard"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <div className="mb-2 text-xs tracking-widest text-white/50 uppercase">
        Global Top 10
      </div>
      {leaderboard.length === 0 ? (
        <p className="text-sm text-white/40">No scores yet — be the first!</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {leaderboard.map((entry, i) => (
            <li
              key={entry.subject}
              data-testid="leaderboard-row"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="w-5 text-white/40 tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate text-white/90">{entry.name}</span>
              <span className="font-mono font-bold text-[#37e0c9] tabular-nums">
                {entry.best}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [x] **Step 3: PersonalBest**

Create `src/game/react/PersonalBest.tsx`:

```tsx
"use client";

import { useAuth, useScores } from "../account/context";

/** Signed-in user's personal best, or a sign-in prompt. Testid: personal-best. */
export function PersonalBest() {
  const { user } = useAuth();
  const { personalBest } = useScores();
  if (!user) {
    return (
      <p data-testid="personal-best" className="text-sm text-white/50">
        Sign in to save your score
      </p>
    );
  }
  return (
    <p data-testid="personal-best" className="text-sm text-white/70">
      Personal best:{" "}
      <span className="font-mono font-bold text-white">{personalBest ?? 0}</span>
    </p>
  );
}
```

- [x] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` then `npx next lint`
Expected: `tsc` exit 0; "No ESLint warnings or errors".

- [x] **Step 5: Commit**

```bash
git add src/game/react/AccountBar.tsx src/game/react/Leaderboard.tsx src/game/react/PersonalBest.tsx
git commit -m "feat: account bar, leaderboard, personal-best UI (testids)"
```

---

### Task 7: Test seam + GameShell wiring

**Files:**
- Modify: `src/game/engine/controller.ts`, `src/game/test-api/install.ts`, `src/game/react/GameShell.tsx`, `e2e/lumines.spec.ts`

- [x] **Step 1: `testEndGame` on the controller**

In `src/game/engine/controller.ts`, add this method next to the other `test*` hooks (after `testPressHardDrop`):

```ts
  /** Deterministically end the current game with an exact final score. */
  testEndGame(score: number): void {
    this.started = true;
    this.state = { ...this.state, score, gameOver: true, active: null };
    this.emit();
  }
```

- [x] **Step 2: `endGame` on the test API (merge, don't overwrite)**

In `src/game/test-api/install.ts`, add to the `LuminesTestApi` interface:

```ts
  pressSoftDrop(): void;
  pressHardDrop(): void;
  endGame(score: number): void;
```

Add to the `api` object:

```ts
    pressSoftDrop: () => controller.testPressSoftDrop(),
    pressHardDrop: () => controller.testPressHardDrop(),
    endGame: (score) => controller.testEndGame(score),
```

Change the install + cleanup to MERGE (so `MockAccountProvider`'s `auth` key survives):

```ts
  const w = window as unknown as { __lumines?: Record<string, unknown> };
  w.__lumines = { ...(w.__lumines ?? {}), ...(api as unknown as Record<string, unknown>) };
  return () => {
    const cur = window.__lumines as unknown as Record<string, unknown> | undefined;
    if (cur) for (const k of Object.keys(api)) delete cur[k];
  };
```

(Replace the existing `window.__lumines = api; return () => { if (window.__lumines === api) delete window.__lumines; };`.)

- [x] **Step 3: Sync the e2e `Window.__lumines` type**

In `e2e/lumines.spec.ts`, add to the declared `window.__lumines` object type (after `pressHardDrop`):

```ts
      pressSoftDrop(): void;
      pressHardDrop(): void;
      endGame(score: number): void;
      auth: {
        signIn(id: { name: string; subject: string }): void;
        signOut(): void;
      };
```

- [x] **Step 4: Wrap GameShell in AccountProvider + add account UI + submit effect**

In `src/game/react/GameShell.tsx`:

(a) Add imports after the existing local imports:

```tsx
import { AccountProvider } from "../account/AccountProvider";
import { useAuth, useScores } from "../account/context";
import { AccountBar } from "./AccountBar";
import { Leaderboard } from "./Leaderboard";
import { PersonalBest } from "./PersonalBest";
```

(b) Rename the existing exported `GameShell` function to `GameShellInner` (keep its whole body), then add a new wrapper export above it:

```tsx
export function GameShell() {
  return (
    <AccountProvider>
      <GameShellInner />
    </AccountProvider>
  );
}

function GameShellInner() {
```

(c) Inside `GameShellInner`, after the existing `phaseRef.current = phase;` line, add the gameover submit effect (uses the account seam):

```tsx
  const { submitScore } = useScores();
  const scoreRef = useRef(score);
  scoreRef.current = score;
  useEffect(() => {
    if (phase === "gameover") submitScore(scoreRef.current);
  }, [phase, submitScore]);
```

(d) In the `Header()` render, place the `AccountBar`. Replace the `Header` component body's outer element to include it:

```tsx
function Header() {
  return (
    <div className="mb-6 flex items-end justify-between">
      <h1 className="bg-gradient-to-r from-[#37e0c9] to-[#ff5fb0] bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
        LLMines
      </h1>
      <AccountBar />
    </div>
  );
}
```

(e) In `StartScreen`, add the `Leaderboard` to the right column. Replace `<ControlsCheatsheet />` (the last child of the grid) with:

```tsx
      <div className="flex flex-col gap-6">
        <ControlsCheatsheet />
        <Leaderboard />
      </div>
```

(f) In `GameOverScreen`, add personal best + leaderboard. Insert before the closing `</section>` (after the "Play again" button):

```tsx
      <div className="mt-6">
        <PersonalBest />
      </div>
      <div className="mt-4 text-left">
        <Leaderboard />
      </div>
```

Note: `Header` is rendered once at the top of `GameShellInner`'s `<main>`, so `AccountBar` shows on all phases. `GameOverScreen` already receives `score`; no new prop needed (submit uses the live `score` state via `scoreRef`).

- [x] **Step 5: Typecheck + lint + existing suites**

Run: `npx tsc --noEmit`, `npx next lint`, `npx vitest run`
Expected: `tsc` exit 0; lint clean; all unit + convex tests green.

- [x] **Step 6: Commit**

```bash
git add src/game/engine/controller.ts src/game/test-api/install.ts src/game/react/GameShell.tsx e2e/lumines.spec.ts
git commit -m "feat: wire account UI into GameShell + endGame test seam"
```

---

### Task 8: e2e — auth + score submission (black-box, TEST_MODE)

**Files:**
- Create: `e2e/leaderboard.spec.ts`

- [x] **Step 1: Write the spec**

Create `e2e/leaderboard.spec.ts`:

```typescript
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __lumines?: {
      endGame(score: number): void;
      auth: {
        signIn(id: { name: string; subject: string }): void;
        signOut(): void;
      };
    };
  }
}

async function signIn(page: Page, name: string, subject: string): Promise<void> {
  await page.evaluate((id) => window.__lumines!.auth.signIn(id), { name, subject });
}
async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => window.__lumines!.auth.signOut());
}
async function endGame(page: Page, score: number): Promise<void> {
  await page.evaluate((s) => window.__lumines!.endGame(s), score);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("signed-out user sees sign-in and plays without being saved", async ({ page }) => {
  await expect(page.getByTestId("signin")).toBeVisible();
  await page.getByTestId("start-button").click();
  await endGame(page, 999);
  // Game-over screen shows the prompt, not a personal best; no leaderboard row.
  await expect(page.getByTestId("personal-best")).toContainText("Sign in");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("sign in reflects in the UI; sign out reverts", async ({ page }) => {
  await signIn(page, "Ada", "user-ada");
  await expect(page.getByTestId("user-name")).toHaveText("Ada");
  await expect(page.getByTestId("signout")).toBeVisible();
  await expect(page.getByTestId("signin")).toHaveCount(0);
  await signOut(page);
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
});

test("signed-in score persists; personal best only rises; leaderboard reflects it", async ({
  page,
}) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();

  await endGame(page, 100);
  await expect(page.getByTestId("personal-best")).toContainText("100");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("100");

  // A worse run does NOT lower the personal best.
  await page.getByTestId("restart").click();
  await endGame(page, 40);
  await expect(page.getByTestId("personal-best")).toContainText("100");

  // A better run raises it.
  await page.getByTestId("restart").click();
  await endGame(page, 250);
  await expect(page.getByTestId("personal-best")).toContainText("250");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("250");
});

test("a second user reorders the global leaderboard", async ({ page }) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();
  await endGame(page, 100);

  await signIn(page, "Bo", "user-bo");
  await page.getByTestId("restart").click();
  await endGame(page, 300);

  await expect(page.getByTestId("leaderboard-row")).toHaveCount(2);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("Bo");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("300");
});

test("unauthenticated game-over is not written to the leaderboard", async ({ page }) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();
  await endGame(page, 100);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);

  await signOut(page);
  await page.getByTestId("restart").click();
  await endGame(page, 999);
  // Still only Ada's row; the signed-out 999 was not written.
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("100");
});
```

- [x] **Step 2: Run the e2e suite**

Run: `npx playwright test`
Expected: PASS — all prior tests plus the 5 new leaderboard tests. (The dev server is started by `playwright.config.ts` with `NEXT_PUBLIC_TEST_MODE=1`, so the MockAccountProvider + window seam are active.)

- [x] **Step 3: Commit**

```bash
git add e2e/leaderboard.spec.ts
git commit -m "test: e2e for auth + leaderboard against the mock"
```

---

### Task 9: Full verification sweep

- [x] **Step 1: Run everything**

- `npx vitest run` — Expected: all green (core, hold, fall-progress, controller, score-fx, mock-store, convex/scores).
- `npx tsc --noEmit` — Expected: exit 0.
- `npx next lint` — Expected: "No ESLint warnings or errors".
- `npx prettier --write "src/**/*.{ts,tsx}" "convex/**/*.ts" "e2e/**/*.ts"` then `npx prettier --check ...` — Expected: formatted / pass.
- `NEXT_PUBLIC_TEST_MODE=1 SKIP_ENV_VALIDATION=1 npx next build` — Expected: build succeeds (the auth route + real provider compile).
- `npx playwright test` — Expected: all e2e green.

- [x] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore: format accounts + leaderboard changes" || echo "nothing to format"
```

---

## Self-Review

**1. Spec coverage:**
- Google sign-in/out reflected in UI → `AccountBar` + `useAuth`; e2e (Task 8). NextAuth config (Task 5). ✓
- Signed-in score persisted; personal best only when beaten → `submitScore` (convex-test Task 2) + `MockStore` (Task 3) + submit effect (Task 7) + e2e (Task 8). ✓
- Global top-10 from Convex, reflects new score → `topN` + `Leaderboard`; e2e reorder test. ✓
- Unauth plays, not written → server identity gate (Task 2) + mock no-op (Task 3) + e2e (Task 8). ✓
- DOM testids `signin/signout/user-name/personal-best/leaderboard/leaderboard-row` → Task 6. ✓
- `window.__lumines.auth.signIn/signOut` + `endGame` (TEST_MODE) → Task 4 (auth) + Task 7 (endGame). ✓
- Build mock-first, never touch real Convex; commit `_generated`; convex-test; injectable seam → Tasks 1–4. `convex dev/deploy/login` never run. ✓
- Security (server-derived user) → Task 2 functions + convex-test isolation test. ✓

**2. Placeholder scan:** No TBD/TODO-as-work; every code step has complete code + exact commands + expected output. The one explicitly-deferred item (live NextAuth→Convex token bridge) is documented in `RealAccountProvider` and is out of eval scope per the spec, not a plan gap.

**3. Type consistency:** `AuthUser{subject,name,image?}`, `AuthApi{user,signIn,signOut}`, `LeaderboardEntry{subject,name,best}`, `ScoresApi{personalBest,leaderboard,submitScore}`, `MockStore.submit/personalBest/topN`, `submitScore({score})`/`topN({n?})`/`personalBest()`, `testEndGame(score)`, `window.__lumines.auth.signIn({name,subject})/signOut()` + `endGame(score)` are used identically across tasks and match `install.ts` ↔ `e2e`. `api.scores.*` references resolve via the hand-written `_generated/api`.
