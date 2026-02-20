// Shared theme definitions for sandybridge.io sites

export type Theme = 'gruvbox' | 'dracula' | 'alucard' | 'nord' | 'catppuccin' | 'one-dark' | 'solarized' | 'prism' | 'oil-spill';
export type Mode = 'light' | 'dark';

export interface ThemeConfig {
  id: Theme;
  name: string;
}

export const THEMES: ThemeConfig[] = [
  { id: 'gruvbox', name: "Gruvbox" },
  { id: 'dracula', name: 'Dracula' },
  { id: 'alucard', name: 'Alucard' },
  { id: 'nord', name: 'Nord' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'one-dark', name: 'One Dark' },
  { id: 'solarized', name: 'Solarized' },
  { id: 'prism', name: 'Prism' },
  { id: 'oil-spill', name: 'Oil Spill' },
];

export const THEME_IDS = THEMES.map(t => t.id);

export const DEFAULT_THEME: Theme = 'gruvbox';
export const DEFAULT_MODE: Mode = 'dark';

// Background colors for each theme/mode (used for initial page load flash prevention)
export const THEME_BACKGROUNDS: Record<Theme, Record<Mode, string>> = {
  gruvbox: { dark: '#151515', light: '#fbf1c7' },
  dracula: { dark: '#282a36', light: '#f8f8f2' },
  alucard: { dark: '#0a0a0f', light: '#f8f8f2' },
  nord: { dark: '#2e3440', light: '#eceff4' },
  catppuccin: { dark: '#1e1e2e', light: '#eff1f5' },
  'one-dark': { dark: '#282c34', light: '#fafafa' },
  solarized: { dark: '#002b36', light: '#fdf6e3' },
  prism: { dark: '#0a0a0c', light: '#fefefe' },
  'oil-spill': { dark: '#08080c', light: '#f0f8f8' },
};

// Cookie utilities for cross-subdomain theme sharing
const COOKIE_DOMAIN = '.sandybridge.io';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function setCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;

  const isProduction = window.location.hostname.endsWith('sandybridge.io');
  let cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;

  if (isProduction) {
    cookie += `; domain=${COOKIE_DOMAIN}`;
  }

  document.cookie = cookie;
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

// Generate inline script for initial theme (prevents flash)
// Reads from cookies first (for cross-subdomain sharing), falls back to localStorage
export function generateThemeScript(): string {
  const bgJson = JSON.stringify(THEME_BACKGROUNDS);
  return `(function(){
    function gc(n){var m=document.cookie.match(new RegExp('(^| )'+n+'=([^;]+)'));return m?decodeURIComponent(m[2]):null;}
    var t=gc('theme')||localStorage.getItem('theme')||'gruvbox';
    var m=gc('mode')||localStorage.getItem('mode');
    if(!m){m=window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';}
    document.documentElement.setAttribute('data-theme',t);
    document.documentElement.setAttribute('data-mode',m);
    var bg=${bgJson};
    var c=bg[t]&&bg[t][m]?bg[t][m]:bg.gruvbox[m];
    document.documentElement.style.backgroundColor=c;
  })();`;
}

// Validate theme ID
export function isValidTheme(theme: string): theme is Theme {
  return THEME_IDS.includes(theme as Theme);
}

// Validate mode
export function isValidMode(mode: string): mode is Mode {
  return mode === 'light' || mode === 'dark';
}
