'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  THEMES,
  type Theme,
  type Mode,
  getCookie,
  setCookie,
  isValidTheme,
  isValidMode,
  DEFAULT_THEME,
  DEFAULT_MODE,
} from '@thesandybridge/themes';

export { THEMES, type Theme, type Mode };

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
  themes: typeof THEMES;
}>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  mode: DEFAULT_MODE,
  setMode: () => {},
  toggleMode: () => {},
  themes: THEMES,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [mode, setModeState] = useState<Mode>(DEFAULT_MODE);

  useEffect(() => {
    // Check cookies first (cross-subdomain), then localStorage
    const savedTheme = getCookie('theme') || localStorage.getItem('theme');
    const savedMode = getCookie('mode') || localStorage.getItem('mode');

    if (savedTheme && isValidTheme(savedTheme)) {
      setThemeState(savedTheme);
    }

    // Use saved mode, or fall back to system preference
    if (savedMode && isValidMode(savedMode)) {
      setModeState(savedMode);
      document.documentElement.setAttribute('data-mode', savedMode);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemMode = prefersDark ? 'dark' : 'light';
      setModeState(systemMode);
      document.documentElement.setAttribute('data-mode', systemMode);
    }
  }, []);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if user hasn't set a manual preference
      const savedMode = getCookie('mode') || localStorage.getItem('mode');
      if (!savedMode) {
        const newMode = e.matches ? 'dark' : 'light';
        setModeState(newMode);
        document.documentElement.setAttribute('data-mode', newMode);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
    setCookie('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    localStorage.setItem('mode', m);
    setCookie('mode', m);
    document.documentElement.setAttribute('data-mode', m);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ theme, setTheme, mode, setMode, toggleMode, themes: THEMES }),
    [theme, setTheme, mode, setMode, toggleMode]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
