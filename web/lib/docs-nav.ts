export interface DocNavItem {
  title: string;
  href: string;
  icon?: string;
}

export interface DocNavGroup {
  title: string;
  icon?: string;
  items: DocNavItem[];
}

export const NAV_GROUPS: DocNavGroup[] = [
  {
    title: "Getting Started",
    icon: "Rocket",
    items: [
      { title: "Introduction", href: "/docs", icon: "BookOpen" },
      { title: "Quick Start", href: "/docs/quick-start", icon: "Zap" },
    ],
  },
  {
    title: "API",
    icon: "Server",
    items: [
      { title: "REST API", href: "/docs/api", icon: "Globe" },
      { title: "Authentication", href: "/docs/authentication", icon: "Shield" },
      { title: "API Keys", href: "/docs/api-keys", icon: "Key" },
    ],
  },
  {
    title: "Guides",
    icon: "BookMarked",
    items: [
      { title: "Tile Formats", href: "/docs/tile-formats", icon: "Layers" },
      { title: "Projections", href: "/docs/projections", icon: "Map" },
      { title: "Leaflet Integration", href: "/docs/leaflet", icon: "MapPin" },
      { title: "CLI", href: "/docs/cli", icon: "Terminal" },
    ],
  },
];

export const UNGROUPED_NAV: DocNavItem[] = [
  { title: "Changelog", href: "/docs/changelog", icon: "Newspaper" },
];

export const DOC_SECTIONS: { slug: string }[] = [
  { slug: "quick-start" },
  { slug: "api" },
  { slug: "authentication" },
  { slug: "api-keys" },
  { slug: "tile-formats" },
  { slug: "projections" },
  { slug: "leaflet" },
  { slug: "cli" },
];
