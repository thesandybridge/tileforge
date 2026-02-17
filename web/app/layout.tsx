import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

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
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="#1a2e1a" media="(prefers-color-scheme: dark)" />
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
      <body className={`${inter.className} min-h-screen antialiased`}>
        <SessionProvider>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
