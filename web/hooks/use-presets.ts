"use client";

import { useState, useEffect, useCallback } from "react";

export interface Preset {
  id: string;
  name: string;
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  projection: "flat" | "mercator" | "isometric";
}

const STORAGE_KEY = "tileforge:presets";

function loadPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPresets(loadPresets());
    setMounted(true);
  }, []);

  const addPreset = useCallback((preset: Omit<Preset, "id">) => {
    const newPreset: Preset = {
      ...preset,
      id: crypto.randomUUID(),
    };
    setPresets((prev) => {
      const updated = [...prev, newPreset];
      savePresets(updated);
      return updated;
    });
    return newPreset;
  }, []);

  const updatePreset = useCallback((id: string, preset: Partial<Omit<Preset, "id">>) => {
    setPresets((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, ...preset } : p));
      savePresets(updated);
      return updated;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      savePresets(updated);
      return updated;
    });
  }, []);

  const getPreset = useCallback(
    (id: string) => presets.find((p) => p.id === id),
    [presets]
  );

  return {
    presets,
    addPreset,
    updatePreset,
    deletePreset,
    getPreset,
    mounted,
  };
}
