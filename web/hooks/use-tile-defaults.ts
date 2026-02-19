"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface TileDefaults {
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  projection: "flat" | "mercator" | "isometric";
  defaultPublic: boolean;
}

const STORAGE_KEY = "tileforge:tile-defaults";

const DEFAULT_VALUES: TileDefaults = {
  tileSize: 256,
  minZoom: 0,
  maxZoom: 4,
  projection: "flat",
  defaultPublic: false,
};

let listeners: Array<() => void> = [];

function emitChange() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): TileDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_VALUES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_VALUES;
}

function getServerSnapshot(): TileDefaults {
  return DEFAULT_VALUES;
}

export function useTileDefaults() {
  const defaults = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((patch: Partial<TileDefaults>) => {
    const current = getSnapshot();
    const next = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitChange();
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    emitChange();
  }, []);

  return { defaults, update, reset };
}
