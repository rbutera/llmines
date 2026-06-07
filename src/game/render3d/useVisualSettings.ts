"use client";

import { useEffect } from "react";
import { folder, useControls } from "leva";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type VisualSettings,
} from "./settings";

/**
 * Live, persisted visual-settings panel (leva) — "a settings page just like the
 * sandbox" (Rai). Reads the persisted values as the leva initial state so a
 * reload restores the last-tuned look, exposes every Phase-1 visual param, and
 * writes every change straight back to localStorage. The panel is the exact same
 * control set Rai tuned against the standalone sandbox.
 *
 * Determinism note: these are PURELY cosmetic. None of these values touch the
 * deterministic core, the controller, or the window.__lumines seam.
 */
export function useVisualSettings(): VisualSettings {
  // Seed leva from persisted storage (falls back to Rai's baked defaults).
  const initial = loadSettings();

  // Object form (not the `() => schema` function form) so the return is the
  // flat values object, typed by leva's SchemaToValues — folders flatten their
  // keys up to the top level. The function form would return a [values, set]
  // tuple instead.
  const values = useControls({
    Projection: folder({
      shear: { value: initial.shear, min: 0, max: 2, step: 0.02 },
      zoom: { value: initial.zoom, min: 12, max: 60, step: 1 },
    }),
    Material: folder({
      emissiveIntensity: {
        value: initial.emissiveIntensity,
        min: 0,
        max: 4,
        step: 0.05,
      },
      beatPulse: { value: initial.beatPulse },
      brightFaceIntensity: {
        value: initial.brightFaceIntensity,
        min: 0,
        max: 5,
        step: 0.05,
      },
      innerLightIntensity: {
        value: initial.innerLightIntensity,
        min: 0,
        max: 5,
        step: 0.05,
      },
      glassOpacity: { value: initial.glassOpacity, min: 0, max: 1, step: 0.01 },
      darkFaceIntensity: {
        value: initial.darkFaceIntensity,
        min: 0,
        max: 3,
        step: 0.05,
      },
      darkCoreIntensity: {
        value: initial.darkCoreIntensity,
        min: 0,
        max: 5,
        step: 0.05,
      },
    }),
    Grid: folder({
      gridOpacity: { value: initial.gridOpacity, min: 0, max: 1, step: 0.01 },
    }),
    Bloom: folder({
      bloomIntensity: {
        value: initial.bloomIntensity,
        min: 0,
        max: 4,
        step: 0.05,
      },
      luminanceThreshold: {
        value: initial.luminanceThreshold,
        min: 0,
        max: 1.5,
        step: 0.01,
      },
    }),
  });

  // `values` is the flat, typed leva values object (folders flattened). Build
  // the settings struct from it; the `??` guards are belt-and-braces for any
  // value leva might transiently report as undefined.
  const settings: VisualSettings = {
    shear: values.shear ?? DEFAULT_SETTINGS.shear,
    zoom: values.zoom ?? DEFAULT_SETTINGS.zoom,
    emissiveIntensity: values.emissiveIntensity ?? DEFAULT_SETTINGS.emissiveIntensity,
    beatPulse: values.beatPulse ?? DEFAULT_SETTINGS.beatPulse,
    brightFaceIntensity:
      values.brightFaceIntensity ?? DEFAULT_SETTINGS.brightFaceIntensity,
    innerLightIntensity:
      values.innerLightIntensity ?? DEFAULT_SETTINGS.innerLightIntensity,
    glassOpacity: values.glassOpacity ?? DEFAULT_SETTINGS.glassOpacity,
    darkFaceIntensity: values.darkFaceIntensity ?? DEFAULT_SETTINGS.darkFaceIntensity,
    darkCoreIntensity: values.darkCoreIntensity ?? DEFAULT_SETTINGS.darkCoreIntensity,
    gridOpacity: values.gridOpacity ?? DEFAULT_SETTINGS.gridOpacity,
    bloomIntensity: values.bloomIntensity ?? DEFAULT_SETTINGS.bloomIntensity,
    luminanceThreshold:
      values.luminanceThreshold ?? DEFAULT_SETTINGS.luminanceThreshold,
  };

  // Persist on every change so tweaks survive reload.
  useEffect(() => {
    saveSettings(settings);
    // The individual primitives are the real dependency set; `settings` is a
    // fresh object each render so we depend on its fields explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.shear,
    settings.zoom,
    settings.emissiveIntensity,
    settings.beatPulse,
    settings.brightFaceIntensity,
    settings.innerLightIntensity,
    settings.glassOpacity,
    settings.darkFaceIntensity,
    settings.darkCoreIntensity,
    settings.gridOpacity,
    settings.bloomIntensity,
    settings.luminanceThreshold,
  ]);

  return settings;
}
