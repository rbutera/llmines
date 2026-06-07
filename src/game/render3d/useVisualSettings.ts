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
    "Beat (a11y: gentle only)": folder({
      beatReactive: { value: initial.beatReactive },
      // Hard-capped at 0.3 so even at the slider max this is a swell, not a
      // strobe. The default (0.12) is a small, slow breathe.
      beatStrength: { value: initial.beatStrength, min: 0, max: 0.3, step: 0.01 },
    }),
    Bursts: folder({
      burstEnabled: { value: initial.burstEnabled },
      burstPerCell: { value: initial.burstPerCell, min: 1, max: 20, step: 1 },
      burstCap: { value: initial.burstCap, min: 10, max: 200, step: 5 },
    }),
    Background: folder({
      bgEnabled: { value: initial.bgEnabled },
      bgIntensity: { value: initial.bgIntensity, min: 0, max: 1, step: 0.01 },
    }),
    "Heat glow": folder({
      heatEnabled: { value: initial.heatEnabled },
      heatIntensity: { value: initial.heatIntensity, min: 0, max: 4, step: 0.05 },
    }),
    Gems: folder({
      gemEnabled: { value: initial.gemEnabled },
      gemIntensity: { value: initial.gemIntensity, min: 0, max: 4, step: 0.05 },
    }),
    Preview: folder({
      previewEnabled: { value: initial.previewEnabled },
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
    beatReactive: values.beatReactive ?? DEFAULT_SETTINGS.beatReactive,
    beatStrength: values.beatStrength ?? DEFAULT_SETTINGS.beatStrength,
    burstEnabled: values.burstEnabled ?? DEFAULT_SETTINGS.burstEnabled,
    burstPerCell: values.burstPerCell ?? DEFAULT_SETTINGS.burstPerCell,
    burstCap: values.burstCap ?? DEFAULT_SETTINGS.burstCap,
    bgEnabled: values.bgEnabled ?? DEFAULT_SETTINGS.bgEnabled,
    bgIntensity: values.bgIntensity ?? DEFAULT_SETTINGS.bgIntensity,
    heatEnabled: values.heatEnabled ?? DEFAULT_SETTINGS.heatEnabled,
    heatIntensity: values.heatIntensity ?? DEFAULT_SETTINGS.heatIntensity,
    gemEnabled: values.gemEnabled ?? DEFAULT_SETTINGS.gemEnabled,
    gemIntensity: values.gemIntensity ?? DEFAULT_SETTINGS.gemIntensity,
    previewEnabled: values.previewEnabled ?? DEFAULT_SETTINGS.previewEnabled,
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
    settings.beatReactive,
    settings.beatStrength,
    settings.burstEnabled,
    settings.burstPerCell,
    settings.burstCap,
    settings.bgEnabled,
    settings.bgIntensity,
    settings.heatEnabled,
    settings.heatIntensity,
    settings.gemEnabled,
    settings.gemIntensity,
    settings.previewEnabled,
  ]);

  return settings;
}
