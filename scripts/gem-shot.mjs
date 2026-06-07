// Gem-visibility capture. Forces every piece special (?gem=1) and shoots a burst
// of frames right after each spawn (one of the 4 active cells carries the gem
// marker) plus a settled board, so at least one frame clearly shows a gem on the
// active piece AND gems in the stack. Self-contained (no debug probe needed).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3236";
const OUT = process.argv[3] ?? `${process.env.HOME}/focused/vault/reviews/llmines-cohesion`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/?gem=1`, { waitUntil: "networkidle" });
await sleep(700);
await page.getByTestId("start-button").click();

// Capture the freshly-spawned active piece on several different pieces (each
// spawn sits at the top for the hold beat, gem marker visible on one cell).
for (let i = 0; i < 4; i++) {
  await sleep(250);
  await page.screenshot({ path: join(OUT, `gem-active-${i}.png`) });
  console.log(`shot: gem-active-${i}.png`);
  await page.keyboard.press("Space"); // drop -> next piece spawns
  await sleep(450);
}

// Settle a stacked board so gems appear throughout the stack.
for (let i = 0; i < 8; i++) { await page.keyboard.press("Space"); await sleep(450); }
await page.screenshot({ path: join(OUT, "gem-settled.png") });
console.log("shot: gem-settled.png");

console.log(errors.length ? `CONSOLE ERRORS: ${errors.join(" | ")}` : "no console errors");
await browser.close();
