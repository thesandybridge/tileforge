"use client";

import { useEffect } from "react";
import { hydratePreferences, usePreferencesStore, type TileDefaults } from "@/lib/preferences-store";

export type { TileDefaults };

export function useTileDefaults() {
  const defaults = usePreferencesStore((state) => state.defaults);
  const hydrated = usePreferencesStore((state) => state.hydrated);
  const update = usePreferencesStore((state) => state.setDefaults);
  const reset = usePreferencesStore((state) => state.resetDefaults);
  useEffect(() => {
    if (!hydrated) void hydratePreferences();
  }, [hydrated]);
  return { defaults, update, reset };
}
