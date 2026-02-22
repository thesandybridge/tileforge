import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "TileForge pricing — free browser-based tile generation or upgrade to Pro for server processing, TIFF/GeoTIFF support, persistent storage, and API access.",
  keywords: [
    "tileforge pricing",
    "tile generator pricing",
    "map tile service",
    "xyz tile api",
  ],
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
