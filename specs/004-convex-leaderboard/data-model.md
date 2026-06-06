# Phase 1 Data Model: Accounts, High Scores & Global Leaderboard

## Convex schema (`convex/schema.ts`)

### Table: `scores` — one document per user (their personal best)

| Field | Type | Meaning |
|-------|------|---------|
| `subject` | `string` | Server-derived stable identity id (`ctx.auth.getUserIdentity().subject`). The user key. |
| `name` | `string` | Display name from the identity (for leaderboard rows). Refreshed on submit. |
| `best` | `number` | The user's highest score so far. |
| `updatedAt` | `number` | Timestamp of the last best update (tie-break for ranking). |

Indexes:
- `by_subject` on `["subject"]` — upsert + `personalBest` lookup (unique per user).
- `by_best` on `["best"]` — efficient `topN` ordering.

Validation / invariants:
- Exactly one document per `subject` (upsert, never duplicate).
- `best` is monotonic non-decreasing per user (only replaced when a new score is strictly
  greater).
- `subject`/`name` are written from the authenticated identity only — never from client args.

## Entities (conceptual)

- **Player identity** (not stored as its own table; provided by auth): `{ subject, name,
  avatar? }`. `subject` is the trust anchor.
- **Personal best**: the `scores` doc for the caller's `subject` (`best`).
- **Leaderboard entry**: a `scores` doc projected to `{ name, best }` (+ rank by position),
  top 10 by `best` desc, tie-break `updatedAt` asc.

## State transitions (per user, via `submitScore(score)`)

```
no doc ──submit(N)──▶ { best: N }                     (first score)
{ best: B } ──submit(M ≤ B)──▶ { best: B }            (unchanged; not beaten)
{ best: B } ──submit(M > B)──▶ { best: M, updatedAt } (personal best improves)
unauthenticated ──submit(*)──▶ (rejected/no-op)        (FR-007 rule)
```

## Auth seam shape (client, not persisted)

`useAuth()` →
```
{
  status: "authenticated" | "unauthenticated" | "loading",
  name?: string,
  avatar?: string,
  subject?: string,      // mirrors the server identity; never sent as a write arg
  signIn(): void,
  signOut(): void,
}
```

In `TEST_MODE` the mock sets `{status,name,subject}` from
`window.__lumines.auth.signIn({name, subject})`; the injected Convex fake uses the same
`subject` as its `getUserIdentity()` so server-derived attribution matches the UI.

## Read models (queries)

- `personalBest()` → `number | null` (caller's `best`, or null when none / unauthenticated).
- `topN(limit = 10)` → `Array<{ name: string, best: number }>` ordered high→low.

No other tables. No migrations beyond creating `scores`.
