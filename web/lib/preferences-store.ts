"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { DEFAULT_MAX_ZOOM, DEFAULT_MIN_ZOOM, DEFAULT_PROJECTION, DEFAULT_TILE_SIZE, type Projection } from "@/lib/constants";

export interface TileDefaults { tileSize: number; minZoom: number; maxZoom: number; projection: Projection; defaultPublic: boolean }
export interface Preset { id: string; name: string; tileSize: number; minZoom: number; maxZoom: number; projection: Projection }
interface PreferencesState {
  hydrated: boolean; defaults: TileDefaults; presets: Preset[];
  setDefaults: (patch: Partial<TileDefaults>) => void; resetDefaults: () => void;
  addPreset: (preset: Omit<Preset, "id">) => Preset; updatePreset: (id: string, patch: Partial<Omit<Preset, "id">>) => void;
  deletePreset: (id: string) => void; setHydrated: (hydrated: boolean) => void;
}

const DEFAULTS: TileDefaults = { tileSize: DEFAULT_TILE_SIZE, minZoom: DEFAULT_MIN_ZOOM, maxZoom: DEFAULT_MAX_ZOOM, projection: DEFAULT_PROJECTION, defaultPublic: false };
const STORAGE_KEY = "tileforge:preferences";
const LEGACY_DEFAULTS_KEY = "tileforge:tile-defaults";
const LEGACY_PRESETS_KEY = "tileforge:presets";
const VALID_TILE_SIZES = new Set([128, 256, 512]);
const VALID_PROJECTIONS = new Set<Projection>(["flat", "mercator", "isometric"]);

function validDefaults(value: unknown): TileDefaults {
  if (!value || typeof value !== "object") return DEFAULTS;
  const candidate = value as Partial<TileDefaults>;
  return {
    tileSize: VALID_TILE_SIZES.has(candidate.tileSize ?? 0) ? candidate.tileSize! : DEFAULTS.tileSize,
    minZoom: Number.isInteger(candidate.minZoom) && candidate.minZoom! >= 0 ? candidate.minZoom! : DEFAULTS.minZoom,
    maxZoom: Number.isInteger(candidate.maxZoom) && candidate.maxZoom! >= 0 ? candidate.maxZoom! : DEFAULTS.maxZoom,
    projection: VALID_PROJECTIONS.has(candidate.projection!) ? candidate.projection! : DEFAULTS.projection,
    defaultPublic: candidate.defaultPublic === true,
  };
}
function validPresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Preset => {
    if (!item || typeof item !== "object") return false;
    const preset = item as Partial<Preset>;
    return typeof preset.id === "string" && typeof preset.name === "string" && preset.name.length <= 100 && VALID_TILE_SIZES.has(preset.tileSize ?? 0) && Number.isInteger(preset.minZoom) && Number.isInteger(preset.maxZoom) && VALID_PROJECTIONS.has(preset.projection!);
  });
}

/** Imports the two pre-Zustand keys once when the new key does not exist. */
const storage: StateStorage = {
  getItem: (name) => {
    const current = localStorage.getItem(name);
    if (current) return current;
    try {
      const oldDefaults = JSON.parse(localStorage.getItem(LEGACY_DEFAULTS_KEY) ?? "null");
      const oldPresets = JSON.parse(localStorage.getItem(LEGACY_PRESETS_KEY) ?? "null");
      if (!oldDefaults && !oldPresets) return null;
      return JSON.stringify({ state: { defaults: oldDefaults ?? DEFAULTS, presets: oldPresets ?? [] }, version: 1 });
    } catch { return null; }
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const usePreferencesStore = create<PreferencesState>()(persist((set) => ({
  hydrated: false, defaults: DEFAULTS, presets: [],
  setDefaults: (patch) => set((state) => ({ defaults: validDefaults({ ...state.defaults, ...patch }) })),
  resetDefaults: () => set({ defaults: DEFAULTS }),
  addPreset: (preset) => { const next = { ...preset, id: crypto.randomUUID() }; set((state) => ({ presets: [...state.presets, next] })); return next; },
  updatePreset: (id, patch) => set((state) => ({ presets: state.presets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) })),
  deletePreset: (id) => set((state) => ({ presets: state.presets.filter((preset) => preset.id !== id) })),
  setHydrated: (hydrated) => set({ hydrated }),
}), {
  name: STORAGE_KEY, storage: createJSONStorage(() => storage), version: 1, skipHydration: true,
  partialize: ({ defaults, presets }) => ({ defaults, presets }),
  migrate: (persisted) => { const state = persisted as Partial<PreferencesState>; return { defaults: validDefaults(state.defaults), presets: validPresets(state.presets) }; },
}));

let hydration: Promise<void> | undefined;
export function hydratePreferences() {
  hydration ??= usePreferencesStore.persist.rehydrate().then(() => {
    usePreferencesStore.getState().setHydrated(true);
  });
  return hydration;
}
