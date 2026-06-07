import { describe, expect, it } from "vitest";
import { keyToAction } from "./keymap";
import type { InputAction } from "./controller";

function key(k: string): KeyboardEvent {
  return { key: k } as KeyboardEvent;
}

describe("keyToAction control schemes", () => {
  it("maps the ESDF scheme (case-insensitive)", () => {
    const cases: [string, InputAction][] = [
      ["e", "rotate"],
      ["E", "rotate"],
      ["s", "left"],
      ["S", "left"],
      ["d", "softDrop"],
      ["D", "softDrop"],
      ["f", "right"],
      ["F", "right"],
    ];
    for (const [k, action] of cases) {
      expect(keyToAction(key(k)), `${k} -> ${action}`).toBe(action);
    }
  });

  it("keeps the arrow scheme unchanged", () => {
    expect(keyToAction(key("ArrowLeft"))).toBe("left");
    expect(keyToAction(key("ArrowRight"))).toBe("right");
    expect(keyToAction(key("ArrowDown"))).toBe("softDrop");
    expect(keyToAction(key("ArrowUp"))).toBe("rotate");
  });

  it("keeps the vim hjkl scheme unchanged", () => {
    expect(keyToAction(key("h"))).toBe("left");
    expect(keyToAction(key("l"))).toBe("right");
    expect(keyToAction(key("j"))).toBe("softDrop");
    expect(keyToAction(key("k"))).toBe("rotate");
  });

  it("Space is hard-drop in every scheme", () => {
    expect(keyToAction(key(" "))).toBe("hardDrop");
    expect(keyToAction(key("Spacebar"))).toBe("hardDrop");
  });

  it("returns null for unmapped keys", () => {
    expect(keyToAction(key("q"))).toBeNull();
    expect(keyToAction(key("Enter"))).toBeNull();
  });
});
