import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tileforge — Slice Images into XYZ Map Tiles",
  description:
    "Slice any image into XYZ map tiles entirely in your browser. Powered by WebAssembly and Rust. Supports PNG, JPEG, WebP with flat and Mercator projections.",
  keywords: [
    "tileforge",
    "xyz tiles",
    "map tiles",
    "image tiler",
    "slippy map",
    "webassembly",
    "wasm",
    "leaflet tiles",
    "mercator projection",
    "tile generator",
  ],
  openGraph: {
    title: "Tileforge — Slice Images into XYZ Map Tiles",
    description:
      "Slice any image into XYZ map tiles entirely in your browser. Powered by WebAssembly and Rust.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Tileforge — Slice Images into XYZ Map Tiles",
    description:
      "Slice any image into XYZ map tiles entirely in your browser. Powered by WebAssembly and Rust.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
