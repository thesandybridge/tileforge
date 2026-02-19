"use client";

import { useEffect, useCallback } from "react";

interface KeyboardShortcuts {
  onSubmit?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onSubmit,
  onEscape,
  enabled = true,
}: KeyboardShortcuts) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape in inputs
        if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }

      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    },
    [enabled, onSubmit, onEscape]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
