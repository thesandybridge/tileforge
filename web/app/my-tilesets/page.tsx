"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Map, Globe, Grid3X3, Trash2, ImageIcon } from "lucide-react";
import { API_URL, listTileSets, deleteTileSet, type TileSet } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

export default function MyTilesetsPage() {
  const { data: session } = useSession();
  const [tilesets, setTilesets] = useState<TileSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.accessToken) return;
    setLoading(true);
    listTileSets(undefined, session.accessToken)
      .then(setTilesets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session?.accessToken]);

  const handleDelete = async (slug: string) => {
    if (!session?.accessToken) return;
    if (!confirm("Delete this tileset?")) return;
    try {
      await deleteTileSet(slug, session.accessToken);
      setTilesets((prev) => prev.filter((ts) => ts.slug !== slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="py-10">
      <header className="mx-auto max-w-4xl px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          My Tilesets
        </h1>
        <p className="text-muted-foreground mt-2">
          Tilesets you&apos;ve created.
        </p>
      </header>

      <main className="mx-auto mt-10 max-w-4xl px-6">
        {loading && (
          <p className="text-muted-foreground text-center text-sm">
            Loading your tilesets...
          </p>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}

        {!loading && !error && tilesets.length === 0 && (
          <div className="text-muted-foreground py-16 text-center">
            <Map className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No tilesets yet.</p>
            <p className="mt-1 text-sm">
              Process an image with server mode to create a tileset.
            </p>
          </div>
        )}

        {tilesets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {tilesets.map((ts) => (
              <Card key={ts.id} className="border-border/50 group relative overflow-hidden">
                <Link href={`/tilesets/${encodeURIComponent(ts.slug)}`}>
                  <div className="bg-muted/50 relative aspect-video">
                    <img
                      src={`${API_URL}/api/tiles/${encodeURIComponent(ts.slug)}/thumbnail`}
                      alt={ts.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <div className="hidden absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="text-muted-foreground/40 h-10 w-10" />
                    </div>
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Map className="text-primary h-4 w-4" />
                      {ts.name}
                      {ts.public && (
                        <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-normal">
                          public
                        </span>
                      )}
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
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(ts.slug);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
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
