"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Palette, Sun, Moon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemePicker() {
  const { theme, setTheme, mode, toggleMode, themes } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const previewTimeoutRef = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => setMounted(true), []);

  const handlePreviewEnter = useCallback((previewTheme: Theme) => {
    clearTimeout(previewTimeoutRef.current);
    document.documentElement.setAttribute("data-theme", previewTheme);
  }, []);

  const handlePreviewLeave = useCallback(() => {
    previewTimeoutRef.current = setTimeout(() => {
      document.documentElement.setAttribute("data-theme", theme);
    }, 50);
  }, [theme]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) {
        clearTimeout(previewTimeoutRef.current);
        document.documentElement.setAttribute("data-theme", theme);
      }
    },
    [theme]
  );

  const handleSelectTheme = useCallback(
    (t: Theme) => {
      clearTimeout(previewTimeoutRef.current);
      setTheme(t);
    },
    [setTheme]
  );

  if (!mounted) {
    return <Button variant="ghost" size="icon" className="h-8 w-8" disabled />;
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Palette className="h-4 w-4" />
          <span className="sr-only">Select theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={toggleMode} className="gap-2">
          {mode === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          {mode === "dark" ? "Light Mode" : "Dark Mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => handleSelectTheme(t.id)}
            onMouseEnter={() => handlePreviewEnter(t.id)}
            onMouseLeave={handlePreviewLeave}
            className="gap-2 hover:!bg-[rgba(128,128,128,0.2)]"
          >
            <div
              className="h-3 w-3 rounded-full border"
              style={{
                backgroundColor: getThemeAccentColor(t.id, mode),
              }}
            />
            {t.name}
            {theme === t.id && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getThemeAccentColor(themeId: string, mode: "light" | "dark"): string {
  const accents: Record<string, Record<"light" | "dark", string>> = {
    gruvbox: { dark: "#d79921", light: "#b57614" },
    dracula: { dark: "#bd93f9", light: "#9d6dd0" },
    alucard: { dark: "#dc143c", light: "#b01030" },
    nord: { dark: "#88c0d0", light: "#5e81ac" },
    catppuccin: { dark: "#cba6f7", light: "#8839ef" },
    "one-dark": { dark: "#56b6c2", light: "#0184bc" },
    solarized: { dark: "#b58900", light: "#b58900" },
    prism: { dark: "#e8b4d8", light: "#d946ef" },
    "oil-spill": { dark: "#4a9ca8", light: "#2d7a87" },
  };
  return accents[themeId]?.[mode] ?? "#888";
}
