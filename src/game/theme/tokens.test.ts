import { describe, expect, it } from "vitest";
import { LEGACY_CHROME_ACCENTS, THEME } from "./tokens";

describe("chrome theme tokens", () => {
  it("exposes the neon-purple-on-dark token set as hex strings", () => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const key of ["base", "accent", "accentBright", "accentDeep", "text"] as const) {
      expect(THEME[key]).toMatch(hex);
    }
  });

  it("does not leak the legacy teal/pink chrome accents", () => {
    const values = Object.values(THEME).map((v) => v.toLowerCase());
    for (const legacy of LEGACY_CHROME_ACCENTS) {
      expect(values).not.toContain(legacy.toLowerCase());
    }
  });
});
