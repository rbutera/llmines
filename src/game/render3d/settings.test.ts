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

describe("visual settings: gem variants dialled down (item 4)", () => {
  it("the gem marker default is subtler than the old oversized amber default", () => {
    // The pre-polish default was 2.6 (oversized + overpowering). The polish round
    // dials it down so the marker is clear-but-subtle and the block colour shows.
    expect(DEFAULT_SETTINGS.gemIntensity).toBeLessThan(2.6);
  });

  it("exposes light + dark gem variant colours", () => {
    expect(typeof DEFAULT_SETTINGS.gemLightColor).toBe("string");
    expect(typeof DEFAULT_SETTINGS.gemDarkColor).toBe("string");
    expect(DEFAULT_SETTINGS.gemLightColor).not.toBe(DEFAULT_SETTINGS.gemDarkColor);
  });
});
