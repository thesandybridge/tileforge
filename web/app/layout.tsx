import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { generateThemeScript } from "@/lib/themes";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import { QueryProvider } from "@/components/query-provider";
import { Navbar } from "@/components/navbar";
import { CursorGlow } from "@/components/cursor-glow";
import { NotificationProvider } from "@/components/notification-context";
import { TileforgeProvider } from "@/components/tileforge-context";
import { Toaster } from "@/components/toaster";
import { Footer } from "@/components/footer";
import { ErrorBoundary } from "@/components/error-boundary";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { RateLimitProvider } from "@/hooks/use-rate-limit";
import { CommandPaletteProvider } from "@/components/command-palette";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const siteUrl = "https://tileforge.sandybridge.io";
const title = "Tileforge — Slice Images into XYZ Map Tiles";
const description =
  "Free browser-based tool to slice any image into XYZ map tiles. Powered by Rust and WebAssembly. Supports PNG, JPEG, WebP with flat and Web Mercator projections. No uploads — everything runs locally.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s | Tileforge",
  },
  description,
  keywords: [
    "tileforge",
    "xyz tiles",
    "map tiles",
    "image tiler",
    "slippy map",
    "tile generator",
    "webassembly",
    "wasm",
    "rust",
    "leaflet tiles",
    "mercator projection",
    "tile slicer",
    "map tile creator",
    "browser image processing",
    "open source",
  ],
  authors: [{ name: "sandybridge" }],
  creator: "sandybridge",
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Tileforge",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: siteUrl,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: generateThemeScript() }} />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="#1d2021" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#fafaf5" media="(prefers-color-scheme: light)" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Tileforge",
              url: siteUrl,
              description,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Any",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              featureList: [
                "XYZ tile generation",
                "Web Mercator projection",
                "Flat/equirectangular projection",
                "PNG, JPEG, WebP support",
                "Browser-based processing",
                "WebAssembly powered",
                "Interactive Leaflet tile preview",
                "ZIP download",
              ],
            }),
          }}
        />
      </head>
      <body className={`${inter.className} ${geistMono.variable} flex min-h-dvh flex-col antialiased`}>
        <SessionProvider>
          <QueryProvider>
            <ThemeProvider>
              <CommandPaletteProvider>
              <RateLimitProvider>
              <NotificationProvider>
                <TileforgeProvider>
                  <ServiceWorkerRegister />
                  <CursorGlow />
                  <Navbar />
                  <Toaster />
                  <ErrorBoundary>
                    <main className="flex flex-1 flex-col">
                      {children}
                    </main>
                  </ErrorBoundary>
                  <Footer />
                </TileforgeProvider>
              </NotificationProvider>
              </RateLimitProvider>
              </CommandPaletteProvider>
            </ThemeProvider>
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
