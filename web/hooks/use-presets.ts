"use client";

import { useEffect } from "react";
import { hydratePreferences, usePreferencesStore, type Preset } from "@/lib/preferences-store";

export type { Preset };

export function usePresets() {
  const presets = usePreferencesStore((state) => state.presets);
  const hydrated = usePreferencesStore((state) => state.hydrated);
  const addPreset = usePreferencesStore((state) => state.addPreset);
  const updatePreset = usePreferencesStore((state) => state.updatePreset);
  const deletePreset = usePreferencesStore((state) => state.deletePreset);
  useEffect(() => {
    if (!hydrated) void hydratePreferences();
  }, [hydrated]);
  return { presets, addPreset, updatePreset, deletePreset, getPreset: (id: string) => presets.find((preset) => preset.id === id), mounted: hydrated };
}
