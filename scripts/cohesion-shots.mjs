// Scripted Playwright screenshot capture for the design-cohesion + drop-FX
// verification. Drives the REAL Start flow (non-TEST_MODE dev server) and writes
// real production-UI screenshots to the vault. NOT the MCP browser (unreadable
// output dir) — this uses page.screenshot to explicit files.
//
// Usage: node scripts/cohesion-shots.mjs <baseURL> <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3235";
const OUT = process.argv[3] ?? `${process.env.HOME}/focused/vault/reviews/llmines-cohesion`;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

async function shot(name) {
  const p = join(OUT, name);
  await page.screenshot({ path: p });
  console.log("shot:", p);
}

// --- COHESION: start screen (force gem on so the dev toggle is visible too) ---
await page.goto(`${BASE}/?gem=1`, { waitUntil: "networkidle" });
await sleep(800);
await shot("cohesion-01-start.png");

// --- Start the real game ---
await page.getByTestId("start-button").click();
await sleep(1500); // let a piece spawn + sweep begin
await shot("cohesion-02-inplay.png");

// Let some blocks settle so the board is populated.
await sleep(3500);
await shot("cohesion-03-inplay-populated.png");

// --- COHESION: paused overlay (chrome shows) ---
await page.keyboard.press("Escape");
await sleep(400);
await shot("cohesion-04-paused.png");
await page.keyboard.press("Escape"); // resume
await sleep(300);

// --- DROP FX: drive hard-drops and capture mid-fall + impact ---
// Hard-drop is Space. Soft-drop hold is ArrowDown. We capture:
//  (a) a soft-drop in progress (continuous shell + trail), and
//  (b) the instant after a hard-drop (impact shell + after-image trail).
async function dropFxBurst(tag) {
  // engage a soft-drop hold to light the continuous energy shell + trail
  await page.keyboard.down("ArrowDown");
  await sleep(140);
  await shot(`dropfx-${tag}-softdrop.png`);
  await page.keyboard.up("ArrowDown");
  await sleep(120);

  // hard-drop, then grab the very next frames (impact shell expanding + trail)
  await page.keyboard.press("Space");
  await sleep(40);
  await shot(`dropfx-${tag}-impact-0.png`);
  await sleep(90);
  await shot(`dropfx-${tag}-impact-1.png`);
  await sleep(120);
}

for (let i = 0; i < 4; i++) {
  await dropFxBurst(`r${i}`);
  await sleep(700); // let the next piece spawn
}

console.log(errors.length ? `CONSOLE ERRORS: ${errors.join(" | ")}` : "no console errors");
await browser.close();
