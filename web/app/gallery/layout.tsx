import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Browse public tilesets created with TileForge. See examples of XYZ map tiles generated from images, satellite imagery, and custom maps.",
  keywords: [
    "tileforge gallery",
    "map tile examples",
    "xyz tile gallery",
    "tileset showcase",
  ],
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
