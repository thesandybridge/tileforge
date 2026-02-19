"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Map, Globe, Grid3X3, Copy, Check, Eye, EyeOff, Trash2, Pencil, Loader2 } from "lucide-react";
import { useTileset, useUpdateTileset, useDeleteTileset, useTilesetPreview } from "@/hooks/use-tilesets";
import { useApiKey } from "@/hooks/use-api-key";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TilePreview = dynamic(() => import("@/components/tile-preview"), {
  ssr: false,
  loading: () => (
    <p className="text-muted-foreground mt-4 text-sm">Loading map preview...</p>
  ),
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

import type { Highlighter } from "shiki";
import { useEffect } from "react";

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((mod) =>
      mod.createHighlighter({ themes: ["gruvbox-dark-medium"], langs: ["javascript", "typescript"] }),
    );
  }
  return highlighterPromise;
}

function CodeBlock({ code, label, lang = "typescript" }: { code: string; label: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    getHighlighter().then((highlighter) => {
      setHtml(highlighter.codeToHtml(code, { lang, theme: "gruvbox-dark-medium" }));
    });
  }, [code, lang]);

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
      {html ? (
        <div
          className="overflow-x-auto rounded-lg text-xs [&_pre]:p-4 [&_pre]:leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export default function TileSetDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const { data: tileset, isLoading, error } = useTileset(params.slug);
  const updateTileset = useUpdateTileset(params.slug);
  const deleteTileset = useDeleteTileset();
  const preview = useTilesetPreview(params.slug);
  const { data: apiKey } = useApiKey();

  const isOwner = !!(session?.user?.id && tileset?.user_id === session.user.id);
  const backHref = isOwner || session?.user ? "/my-tilesets" : "/gallery";
  const backLabel = isOwner || session?.user ? "My Tilesets" : "Gallery";

  const [editState, setEditState] = useState<
    { editing: false } | { editing: true; name: string }
  >({ editing: false });

  function handleRename() {
    if (!tileset || !editState.editing) return;
    const trimmed = editState.name.trim();
    if (!trimmed || trimmed === tileset.name) {
      setEditState({ editing: false });
      return;
    }
    updateTileset.mutate({ name: trimmed }, { onSuccess: () => setEditState({ editing: false }) });
  }

  function handleToggleVisibility() {
    if (!tileset) return;
    updateTileset.mutate({ public: !tileset.public });
  }

  function handleDelete() {
    if (!tileset) return;
    if (!confirm("Delete this tileset? This cannot be undone.")) return;
    deleteTileset.mutate(tileset.slug, {
      onSuccess: () => router.push("/my-tilesets"),
    });
  }

  function handleLoadPreview() {
    preview.mutate();
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24">
        <p className="text-muted-foreground text-center text-sm">Loading tile set...</p>
      </div>
    );
  }

  const displayError = error?.message ?? updateTileset.error?.message ?? deleteTileset.error?.message ?? preview.error?.message;

  if (displayError || !tileset) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-destructive text-center">{displayError ?? "Tile set not found"}</p>
        <div className="mt-4 text-center">
          <Link
            href={backHref}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const keyParam = apiKey ? "?key=YOUR_API_KEY" : "";
  const tileUrl = `${origin}/api/tiles/${tileset.slug}/download/pmtiles${keyParam}`;

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
    <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start gap-3">
          <Map className="text-primary mt-1 h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            {editState.editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={editState.name}
                  onChange={(e) => setEditState({ editing: true, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditState({ editing: false });
                  }}
                  className="bg-transparent text-3xl font-bold tracking-tight outline-none border-b border-primary w-full"
                />
                <Button size="sm" onClick={handleRename}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditState({ editing: false })}>Cancel</Button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{tileset.name}</h1>
                {isOwner && (
                  <button
                    onClick={() => setEditState({ editing: true, name: tileset.name })}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <p className="text-muted-foreground mt-1 text-sm">
              {tileset.slug}
            </p>
          </div>
        </div>

        {/* Metadata card */}
        <Card className="border-border/50 corona-glow mt-8">
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

        {/* Preview */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Preview</h2>
          {preview.data ? (
            <TilePreview
              zipBlob={preview.data}
              imageWidth={tileset.tile_size * (1 << tileset.max_zoom)}
              imageHeight={tileset.tile_size * (1 << tileset.max_zoom)}
              maxZoom={tileset.max_zoom}
              tileSize={tileset.tile_size}
              projection={tileset.projection as "flat" | "mercator"}
            />
          ) : (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={preview.isPending}
              onClick={handleLoadPreview}
            >
              {preview.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
              ) : (
                <>Load Preview ({formatBytes(tileset.size_bytes)})</>
              )}
            </Button>
          )}
        </div>

        {/* Code snippets — owner only */}
        {isOwner && (
          <div className="mt-8 space-y-6">
            <h2 className="text-lg font-semibold">Use this tile set</h2>

            {apiKey ? (
              <p className="text-muted-foreground text-sm">
                Replace <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">YOUR_API_KEY</code> with
                your full API key.{" "}
                <Link href="/settings" className="text-primary hover:underline">
                  Manage keys
                </Link>
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                <Link href="/settings" className="text-primary hover:underline">
                  Generate an API key
                </Link>{" "}
                to use this tileset in external applications.
              </p>
            )}

            <CodeBlock label="Tile URL" code={tileUrl} />
            <CodeBlock label="Leaflet" code={leafletSnippet} />
            <CodeBlock label="MapLibre GL" code={maplibreSnippet} />
          </div>
        )}

        {/* Actions */}
        <div className="mt-8 flex gap-3">
          {isOwner && (
            <>
              <Button variant="secondary" onClick={handleToggleVisibility}>
                {tileset.public ? (
                  <><EyeOff className="mr-2 h-4 w-4" /> Make Private</>
                ) : (
                  <><Eye className="mr-2 h-4 w-4" /> Publish</>
                )}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>
          )}
        </div>
    </div>
  );
}
