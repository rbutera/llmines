import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The pure core is load-bearing for the deterministic test seam and the eval:
 * `src/game/core/**` must never reach for ambient time, the DOM, or audio. This
 * test asserts that statically so a regression fails CI, not a playtest.
 */

const coreDir = fileURLToPath(new URL(".", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Identifiers that signal a clock / DOM / audio dependency leaking into core.
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "Date", pattern: /\bDate\b/ },
  { name: "performance", pattern: /\bperformance\b/ },
  { name: "AudioContext", pattern: /\bAudioContext\b/ },
  { name: "requestAnimationFrame", pattern: /\brequestAnimationFrame\b/ },
  { name: "setTimeout", pattern: /\bsetTimeout\b/ },
  { name: "setInterval", pattern: /\bsetInterval\b/ },
  // Importing the clock seam (time/ or audio/) from core is also forbidden.
  { name: "clock import", pattern: /from\s+["'][^"']*(time|audio)\/clock["']/ },
  { name: "any clock identifier", pattern: /\bClock\b/ },
];

describe("core purity", () => {
  const files = tsFiles(coreDir);

  it("finds core source files to lint", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`no time/DOM/audio dependency in ${file.split("/core/")[1]}`, () => {
      const src = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN) {
        expect(
          pattern.test(src),
          `${file} references forbidden "${name}"`,
        ).toBe(false);
      }
    });
  }
});
