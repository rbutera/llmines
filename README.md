# LLMines — eval sandbox base

This is the **base repo** for the LLMines SDD eval. It is a clean, minimal full-stack-TypeScript
web-app shell. Eval agents branch off `main` and build **LLMines** here: a browser-based clone of
the puzzle game *Lumines* (2×2 colour blocks fall onto a grid; same-colour 2×2 squares form; a
music-synced timeline bar sweeps across the field clearing them), rendered with PixiJS.

`main` is intentionally just the scaffold — no game logic, no auth, no database. Each eval cell is a
branch + PR off this base.

## Audio fixture

The shared backing track lives at **`public/backing-track.mp3`** (served at `/backing-track.mp3`).

- **~120 BPM** → one beat = **0.5s**. The timeline sweep syncs to this tempo.
- Track length ~205.5s.

### Music credit (required)

> Sano - SET ME FREE [NCS Release]. Music provided by NoCopyrightSounds. https://youtu.be/e1QIqXmZ2os

NoCopyrightSounds tracks are free for public/commercial use **with credit**. This credit string must
appear in the deployed game's footer/credits.

## Stack

Scaffolded with `create-t3-app` (App Router + TypeScript + Tailwind + tRPC). No NextAuth, no ORM/DB.

## Pinned tool versions

| Tool | Version |
|---|---|
| node | 24.16.0 |
| pnpm | 10.32.1 |
| next | 15.5.19 |
| react / react-dom | 19.2.7 |
| pixi.js | 8.18.1 |
| typescript | 5.9.3 |
| tailwindcss | 4.3.0 |
| @trpc/server | 11.17.0 |
| create-t3-app | 7.40.0 |

## Scripts

```bash
pnpm dev      # dev server (localhost:3000)
pnpm build    # production build
pnpm start    # serve the production build
pnpm check    # lint + typecheck
```
