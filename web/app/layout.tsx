import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { generateThemeScript } from "@thesandybridge/themes";
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
import { Favicon } from "@/components/favicon";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const siteUrl = "https://tileforge.sandybridge.io";
const title = "Tileforge — Slice Images into XYZ Map Tiles";
const description =
  "Free browser-based tool to convert images into XYZ map tiles, PMTiles, and isometric projections. Supports PNG, JPEG, WebP, and TIFF/GeoTIFF. Powered by Rust and WebAssembly — no uploads required.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s | Tileforge",
  },
  description,
  keywords: [
    "tileforge",
    "image to map tiles",
    "xyz tile generator",
    "geotiff to tiles",
    "convert image to leaflet tiles",
    "browser tile generator",
    "image to pmtiles",
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
    "tiff tile generator",
    "isometric map tiles",
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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "TileForge — Image to Map Tiles" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
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
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_URL;
  const umamiId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

  return (
    <html lang="en" className="overflow-x-hidden" suppressHydrationWarning>
      <head>
        <meta name="darkreader-lock" />
        <script dangerouslySetInnerHTML={{ __html: generateThemeScript() }} />
        {umamiUrl && umamiId && (
          <Script
            async
            src={umamiUrl}
            data-website-id={umamiId}
            strategy="afterInteractive"
          />
        )}
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
              offers: [
                {
                  "@type": "Offer",
                  name: "Free",
                  price: "0",
                  priceCurrency: "USD",
                  description: "Browser-based WASM processing with ZIP and PMTiles export",
                },
                {
                  "@type": "Offer",
                  name: "Pro",
                  price: "9",
                  priceCurrency: "USD",
                  billingDuration: "P1M",
                  description: "Server processing, TIFF/GeoTIFF support, persistent storage, API access",
                },
              ],
              featureList: [
                "XYZ tile generation",
                "PMTiles export",
                "Web Mercator projection",
                "Flat/equirectangular projection",
                "Isometric 2.5D projection",
                "PNG, JPEG, WebP, TIFF/GeoTIFF support",
                "Browser-based processing",
                "Server-side processing (Pro)",
                "REST API access (Pro)",
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
              <Favicon />
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
