"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Map, Globe, Grid3X3, Copy, Check } from "lucide-react";
import { getTileSet, type TileSet } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {label}
        </p>
        <button
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function TileSetDetailPage() {
  const params = useParams<{ slug: string }>();
  const [tileset, setTileset] = useState<TileSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.slug) return;
    getTileSet(params.slug)
      .then(setTileset)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.slug]);

  if (loading) {
    return (
      <div className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-muted-foreground text-center text-sm">Loading tile set...</p>
        </div>
      </div>
    );
  }

  if (error || !tileset) {
    return (
      <div className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <Link
            href="/gallery"
            className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Gallery
          </Link>
          <p className="text-destructive mt-8 text-center">{error ?? "Tile set not found"}</p>
        </div>
      </div>
    );
  }

  // PMTiles URL pattern — will resolve once CDN is configured
  const pmtilesPath = `${tileset.storage_path}/tiles.pmtiles`;
  const tileUrl = `https://tiles.tileforge.example.com/${pmtilesPath}`;

  const leafletSnippet = `import "pmtiles";
import * as protomapsL from "protomaps-leaflet";

const p = new protomapsL.PMTilesSource(
  "${tileUrl}"
);

L.tileLayer("", {
  // Use with protomaps-leaflet or pmtiles protocol
}).addTo(map);`;

  const maplibreSnippet = `import { Protocol } from "pmtiles";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  style: {
    sources: {
      tiles: {
        type: "raster",
        url: "pmtiles://${tileUrl}",
        tileSize: ${tileset.tile_size},
      },
    },
    layers: [{ id: "tiles", type: "raster", source: "tiles" }],
  },
});`;

  return (
    <div className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <Link
          href="/gallery"
          className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Gallery
        </Link>

        <div className="mt-4 flex items-start gap-3">
          <Map className="text-primary mt-1 h-6 w-6 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tileset.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {tileset.slug}
            </p>
          </div>
        </div>

        {/* Metadata card */}
        <Card className="border-border/50 mt-8">
          <CardHeader>
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Projection</p>
                <p className="mt-1 flex items-center gap-1.5 font-medium">
                  <Globe className="h-3.5 w-3.5" />
                  {tileset.projection}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Tile Size</p>
                <p className="mt-1 flex items-center gap-1.5 font-medium">
                  <Grid3X3 className="h-3.5 w-3.5" />
                  {tileset.tile_size}px
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Zoom Range</p>
                <p className="mt-1 font-medium">{tileset.min_zoom}&ndash;{tileset.max_zoom}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Tiles</p>
                <p className="mt-1 font-medium">{tileset.tile_count.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Size</p>
                <p className="mt-1 font-medium">{formatBytes(tileset.size_bytes)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Visibility</p>
                <p className="mt-1 font-medium">{tileset.public ? "Public" : "Private"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Created</p>
                <p className="mt-1 font-medium">
                  {new Date(tileset.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Code snippets */}
        <div className="mt-8 space-y-6">
          <h2 className="text-lg font-semibold">Use this tile set</h2>

          <CodeBlock label="Tile URL" code={tileUrl} />
          <CodeBlock label="Leaflet" code={leafletSnippet} />
          <CodeBlock label="MapLibre GL" code={maplibreSnippet} />
        </div>

        {/* Actions */}
        <div className="mt-8 flex gap-3">
          <Button variant="secondary" asChild>
            <Link href="/gallery">Back to Gallery</Link>
          </Button>
        </div>
      </div>

      <footer className="text-muted-foreground mt-16 pb-8 text-center text-sm">
        &copy; {new Date().getFullYear()} &mdash; made with &hearts; by sandybridge
      </footer>
    </div>
  );
}
