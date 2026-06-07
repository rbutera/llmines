import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from "./settings";

/** Minimal in-memory window + localStorage stub for the persistence round-trip. */
function installWindowStub(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

function clearWindowStub(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe("visual settings: music volume (item 10)", () => {
  it("defaults to 0.5", () => {
    expect(DEFAULT_SETTINGS.musicVolume).toBe(0.5);
  });

  describe("persistence round-trip", () => {
    beforeEach(installWindowStub);
    afterEach(clearWindowStub);

    it("loads 0.5 when nothing is stored", () => {
      expect(loadSettings().musicVolume).toBe(0.5);
    });

    it("round-trips a changed volume through save/load", () => {
      saveSettings({ ...DEFAULT_SETTINGS, musicVolume: 0.2 });
      expect(loadSettings().musicVolume).toBeCloseTo(0.2);
    });

    it("clamps an out-of-range stored volume back into [0,1]", () => {
      const w = (globalThis as unknown as {
        window: { localStorage: { setItem: (k: string, v: string) => void } };
      }).window;
      w.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ musicVolume: 5 }),
      );
      expect(loadSettings().musicVolume).toBe(1);
      w.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ musicVolume: -3 }),
      );
      expect(loadSettings().musicVolume).toBe(0);
    });
  });
});

describe("visual settings: gem variants are clearly visible (round-2)", () => {
  it("the gem marker default is bright enough to be unmistakable", () => {
    // Round-2 (owner: "saw ZERO gems"). The earlier dialled-down default (1.6 +
    // low-contrast variants) was effectively invisible. The marker must now read
    // clearly, so the default glow is bumped up.
    expect(DEFAULT_SETTINGS.gemIntensity).toBeGreaterThanOrEqual(3);
  });

  it("exposes high-contrast light + dark gem variant colours", () => {
    expect(DEFAULT_SETTINGS.gemLightColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(DEFAULT_SETTINGS.gemDarkColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    // The two variants must differ so each pops against its block type (one for
    // bright/white blocks, one for dark/purple blocks).
    expect(DEFAULT_SETTINGS.gemLightColor).not.toBe(DEFAULT_SETTINGS.gemDarkColor);
  });
});
