<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/004-convex-leaderboard/plan.md`

Active feature: **Accounts, High Scores & Global Leaderboard** — NextAuth (Google SSO) +
Convex (sole backend). One-doc-per-user `scores` (best); `submitScore`/`topN`/`personalBest`
with server-derived identity (`ctx.auth`, never a client userId). DUAL-MODE: build/test
against a deterministic MOCK only — do NOT run `convex dev`/`deploy`/`login`; commit
`convex/_generated/` (codegen offline or hand-authored). Two seams (auth + Convex client) so
the same code runs mock (eval) vs real (later). DOM testids: `signin`/`signout`/`user-name`/
`personal-best`/`leaderboard`/`leaderboard-row`. TEST_MODE adds `window.__lumines.auth.signIn/
signOut` + `endGame(score)`. Tests: `convex-test` (in-memory, mocked identity) + Playwright.
NOTE base is create-t3-app + tRPC with NO convex/next-auth installed yet (library reality).
Prior shipped features: 001 clip fix, 002 new-block hold, 003 animated score.
<!-- SPECKIT END -->
