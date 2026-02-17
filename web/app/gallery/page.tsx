"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Map, ArrowLeft, Globe, Grid3X3 } from "lucide-react";
import { listTileSets, type TileSet } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function GalleryPage() {
  const [tilesets, setTilesets] = useState<TileSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTileSets()
      .then(setTilesets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="py-24">
      <header className="mx-auto max-w-4xl px-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tileforge
        </Link>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Public Tile Sets
        </h1>
        <p className="text-muted-foreground mt-2">
          Browse tile sets shared by the community.
        </p>
      </header>

      <main className="mx-auto mt-10 max-w-4xl px-6">
        {loading && (
          <p className="text-muted-foreground text-center text-sm">
            Loading tile sets...
          </p>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}

        {!loading && !error && tilesets.length === 0 && (
          <div className="text-muted-foreground py-16 text-center">
            <Map className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No public tile sets yet.</p>
            <p className="mt-1 text-sm">
              Processed tile sets marked as public will appear here.
            </p>
          </div>
        )}

        {tilesets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {tilesets.map((ts) => (
              <Card key={ts.id} className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Map className="text-primary h-4 w-4" />
                    {ts.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-muted-foreground space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" />
                      <span>{ts.projection}</span>
                      <span className="text-muted-foreground/40">|</span>
                      <Grid3X3 className="h-3.5 w-3.5" />
                      <span>{ts.tile_size}px</span>
                    </div>
                    <p>
                      Zoom {ts.min_zoom}&ndash;{ts.max_zoom} &middot;{" "}
                      {ts.tile_count.toLocaleString()} tiles &middot;{" "}
                      {formatBytes(ts.size_bytes)}
                    </p>
                    <p className="text-muted-foreground/60 text-xs">
                      {timeAgo(ts.created_at)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <footer className="text-muted-foreground mt-16 pb-8 text-center text-sm">
        &copy; {new Date().getFullYear()} &mdash; made with &hearts; by
        sandybridge
      </footer>
    </div>
  );
}
