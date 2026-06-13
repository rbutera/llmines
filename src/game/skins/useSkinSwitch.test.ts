// @vitest-environment jsdom
/**
 * useSkinSwitch — the slimmed, programmatic-only surface (skins-ux-auth):
 *   - starts on the base skin (SKINS[0]);
 *   - advanceSkin() moves to the next skin and WRAPS (the only progression
 *     trigger — song completion); each advance fires onSwitch + crossfades;
 *   - resetToBaseSkin() jumps INSTANTLY to the base skin (restart / new game);
 *   - NO persistence (never touches localStorage), NO setSkin/cycleSkin toggle.
 *
 * Driven through react-dom in jsdom with rAF stubbed to flush synchronously so
 * the crossfade settles deterministically (no real timers). No JSX (this file is
 * a .test.ts to match the vitest include) — the harness uses createElement.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SKIN, SKINS } from "./skins";
import { type SkinSwitchState, useSkinSwitch } from "./useSkinSwitch";

let container: HTMLDivElement;
let root: Root;
let latest: SkinSwitchState;
let switched: string[];

function Harness({ onSwitch }: { onSwitch: (id: string) => void }): null {
  latest = useSkinSwitch((skin) => onSwitch(skin.id));
  return null;
}

function mount(): void {
  switched = [];
  container = document.createElement("div");
  act(() => {
    root = createRoot(container);
    root.render(createElement(Harness, { onSwitch: (id) => switched.push(id) }));
  });
}

beforeEach(() => {
  // rAF flushes immediately so the crossfade ramp completes within one act().
  // A monotonically advancing timestamp guarantees mix reaches 1.
  let t = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    t += 10000; // far past SKIN_CROSSFADE_MS so the next tick settles mix to 1
    cb(t);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useSkinSwitch programmatic surface", () => {
  it("starts on the base skin", () => {
    mount();
    expect(latest.skin.id).toBe(DEFAULT_SKIN.id);
    expect(latest.skin.id).toBe(SKINS[0]!.id);
    expect(latest.board).toEqual(SKINS[0]!.board);
  });

  it("exposes only advanceSkin + resetToBaseSkin (no toggle)", () => {
    mount();
    expect(typeof latest.advanceSkin).toBe("function");
    expect(typeof latest.resetToBaseSkin).toBe("function");
    const surface = latest as unknown as Record<string, unknown>;
    expect(surface.cycleSkin).toBeUndefined();
    expect(surface.setSkin).toBeUndefined();
  });

  it("advanceSkin moves to the next skin and fires onSwitch", () => {
    mount();
    act(() => latest.advanceSkin());
    expect(latest.skin.id).toBe(SKINS[1]!.id);
    expect(switched).toEqual([SKINS[1]!.id]);
  });

  it("advanceSkin wraps last -> first", () => {
    mount();
    // advance through the whole list back to the base.
    for (const _ of SKINS) act(() => latest.advanceSkin());
    expect(latest.skin.id).toBe(SKINS[0]!.id);
  });

  it("resetToBaseSkin jumps to the base skin instantly (no transition)", () => {
    mount();
    act(() => latest.advanceSkin()); // move off the base
    expect(latest.skin.id).toBe(SKINS[1]!.id);
    act(() => latest.resetToBaseSkin());
    expect(latest.skin.id).toBe(SKINS[0]!.id);
    expect(latest.transitioning).toBe(false);
    expect(latest.board).toEqual(SKINS[0]!.board); // fully on base, not blended
  });

  it("never persists the chosen skin (no localStorage writes)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mount();
    act(() => latest.advanceSkin());
    act(() => latest.resetToBaseSkin());
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
