import { describe, expect, it } from "vitest";
import {
  baseSuggestion,
  normalizeUsername,
  suggestAvailableUsername,
  suggestUsernameFor,
  USERNAME_MAX,
  USERNAME_MIN,
  usernameKey,
  validateUsername,
} from "./usernames";

/**
 * The username layer is the testable core of the auth feature: suggestion from
 * a Google display name, collision numbering, normalisation, and validation.
 * The mock store and the Convex backend both consume THIS module, so these
 * tests pin the rules once for both.
 */

describe("usernameKey (uniqueness key)", () => {
  it("is case-insensitive", () => {
    expect(usernameKey("Mark Jacobs")).toBe(usernameKey("mark jacobs"));
    expect(usernameKey("MARK")).toBe("mark");
  });

  it("collapses and trims whitespace", () => {
    expect(usernameKey("  mark   jacobs  ")).toBe("mark jacobs");
  });

  it("treats differently-spaced names as the same", () => {
    expect(usernameKey("Mark Jacobs")).toBe(usernameKey("Mark  Jacobs"));
  });
});

describe("normalizeUsername (display form)", () => {
  it("trims + collapses internal whitespace but preserves casing", () => {
    expect(normalizeUsername("  Mark   Jacobs ")).toBe("Mark Jacobs");
  });
});

describe("validateUsername", () => {
  it("accepts plain names", () => {
    expect(validateUsername("Mark Jacobs")).toBeNull();
    expect(validateUsername("xX_pro_Xx")).toBeNull();
  });

  it("accepts real-name punctuation", () => {
    expect(validateUsername("O'Hara")).toBeNull();
    expect(validateUsername("Jean-Luc")).toBeNull();
    expect(validateUsername("j.doe")).toBeNull();
  });

  it("accepts unicode letters", () => {
    expect(validateUsername("Renée")).toBeNull();
    expect(validateUsername("田中")).toBeNull();
  });

  it("rejects empty / whitespace-only", () => {
    expect(validateUsername("")).not.toBeNull();
    expect(validateUsername("   ")).not.toBeNull();
  });

  it("rejects too short (collapsed)", () => {
    expect(validateUsername("a")).not.toBeNull();
    expect(validateUsername(" a ")).not.toBeNull();
  });

  it("rejects too long", () => {
    expect(validateUsername("x".repeat(USERNAME_MAX + 1))).not.toBeNull();
    expect(validateUsername("x".repeat(USERNAME_MAX))).toBeNull();
  });

  it("rejects disallowed characters", () => {
    expect(validateUsername("hi@there")).not.toBeNull();
    expect(validateUsername("a/b")).not.toBeNull();
    expect(validateUsername("a#b")).not.toBeNull();
  });

  it("honours the documented min length", () => {
    expect(validateUsername("x".repeat(USERNAME_MIN))).toBeNull();
  });
});

describe("baseSuggestion (from Google display name)", () => {
  it("uses the display name verbatim when clean", () => {
    expect(baseSuggestion("Mark Jacobs")).toBe("Mark Jacobs");
  });

  it("collapses whitespace", () => {
    expect(baseSuggestion("  Mark   Jacobs  ")).toBe("Mark Jacobs");
  });

  it("strips emoji / disallowed chars but keeps the name", () => {
    expect(baseSuggestion("Mark 🚀 Jacobs")).toBe("Mark Jacobs");
    expect(baseSuggestion("Mark <Jacobs>")).toBe("Mark Jacobs");
  });

  it("clamps to the max length", () => {
    const long = "Aurelius Maximus Decimus Meridius The Third";
    expect(baseSuggestion(long).length).toBeLessThanOrEqual(USERNAME_MAX);
  });

  it("falls back to Player on empty / unusable", () => {
    expect(baseSuggestion("")).toBe("Player");
    expect(baseSuggestion(null)).toBe("Player");
    expect(baseSuggestion(undefined)).toBe("Player");
    expect(baseSuggestion("🚀🚀🚀")).toBe("Player");
  });
});

describe("suggestAvailableUsername (collision numbering)", () => {
  const takenSet = (...names: string[]) => {
    const keys = new Set(names.map(usernameKey));
    return (key: string) => keys.has(key);
  };

  it("returns the base when free", () => {
    expect(suggestAvailableUsername("Mark Jacobs", () => false)).toBe(
      "Mark Jacobs",
    );
  });

  it("appends 2 when the base is taken", () => {
    expect(
      suggestAvailableUsername("Mark Jacobs", takenSet("Mark Jacobs")),
    ).toBe("Mark Jacobs 2");
  });

  it("walks up the numbers until free", () => {
    expect(
      suggestAvailableUsername(
        "Mark Jacobs",
        takenSet("Mark Jacobs", "Mark Jacobs 2", "Mark Jacobs 3"),
      ),
    ).toBe("Mark Jacobs 4");
  });

  it("is case-insensitive about what counts as taken", () => {
    expect(
      suggestAvailableUsername("Mark Jacobs", takenSet("mark jacobs")),
    ).toBe("Mark Jacobs 2");
  });

  it("keeps the numbered result within the length cap", () => {
    const root = "x".repeat(USERNAME_MAX);
    const out = suggestAvailableUsername(root, takenSet(root));
    expect(out.length).toBeLessThanOrEqual(USERNAME_MAX);
    expect(out.endsWith(" 2")).toBe(true);
  });

  it("defaults an empty base to Player", () => {
    expect(suggestAvailableUsername("", () => false)).toBe("Player");
  });
});

describe("suggestUsernameFor (end to end)", () => {
  it("suggests the clean display name when free", () => {
    expect(suggestUsernameFor("Mark Jacobs", () => false)).toBe("Mark Jacobs");
  });

  it("numbers a taken display name", () => {
    const taken = new Set(["mark jacobs"]);
    expect(suggestUsernameFor("Mark Jacobs", (k) => taken.has(k))).toBe(
      "Mark Jacobs 2",
    );
  });

  it("the suggestion always passes validation", () => {
    for (const name of ["Mark Jacobs", "🚀", "", "O'Hara", "x".repeat(40)]) {
      const suggestion = suggestUsernameFor(name, () => false);
      expect(validateUsername(suggestion)).toBeNull();
    }
  });
});
