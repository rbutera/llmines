# Contract: Convex Functions (`convex/scores.ts`)

The same functions run under the real backend (normal) and `convex-test` (tests). Identity
is always server-derived. The in-memory fake client (TEST_MODE UI) mirrors this surface.

## `submitScore` — mutation

```
submitScore(args: { score: number }): Promise<{ best: number } | null>
```

Rules (INV-A: server-derived identity):
- Read `const id = await ctx.auth.getUserIdentity()`.
- If `id` is null → **do not write**; return `null` (the unauthenticated rule, FR-007).
- Else `subject = id.subject`, `name = id.name ?? "Player"`.
- Upsert the `scores` doc for `subject`:
  - no doc → insert `{ subject, name, best: score, updatedAt: now }`;
  - existing `{ best }` → update to `{ best: max(best, score), name, updatedAt }`,
    changing `best`/`updatedAt` **only when `score > best`** (INV-B: monotonic best).
- **MUST NOT** accept or read any `userId`/`subject` from `args` (INV-A / security gate).

## `topN` — query

```
topN(args?: { limit?: number }): Promise<Array<{ name: string; best: number }>>
```

- Returns up to `limit` (default 10) `scores` projected to `{ name, best }`, ordered by
  `best` descending, tie-break `updatedAt` ascending. (INV-C: ≤10, sorted, one row per user.)

## `personalBest` — query

```
personalBest(): Promise<number | null>
```

- Read identity; if null → `null`. Else return the caller's `scores.best` (or `null` if no
  doc yet). (INV-D: reflects only the caller's own best.)

## Verification (via `convex-test`, mocked identity)

| Inv | Check |
|-----|-------|
| INV-A | `t.withIdentity({subject:"u1"})` submits; doc has `subject:"u1"`; a call with `subject` in args (if attempted) is ignored — attribution always the identity. A second identity `u2` gets its own row and cannot overwrite `u1`. Unauthenticated submit writes nothing. |
| INV-B | submit N → best N; submit M≤N → still N; submit M>N → M. |
| INV-C | several users/scores → `topN` returns ≤10, high→low, one row per user. |
| INV-D | `personalBest()` returns the caller's best; another identity's submissions don't change it. |
