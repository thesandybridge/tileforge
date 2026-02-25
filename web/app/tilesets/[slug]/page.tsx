"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Map, Globe, Grid3X3, Copy, Check, Eye, EyeOff, Trash2, Pencil, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { API_URL } from "@/lib/api";
import { useTileset, useUpdateTileset, useDeleteTileset, usePmtilesUrl } from "@/hooks/use-tilesets";
import { useApiKey } from "@/hooks/use-api-key";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TilesetDetailSkeleton } from "@/components/tileset-skeleton";

const PmtilesPreview = dynamic(() => import("@/components/pmtiles-preview"), {
  ssr: false,
  loading: () => (
    <p className="text-muted-foreground mt-4 text-sm">Loading map preview...</p>
  ),
});

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

  const onCopy = async () => {
    await copyToClipboard(code, label);
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
          className="overflow-x-auto rounded-lg text-xs [&_pre]:p-4 [&_pre]:leading-relaxed [&_pre]:whitespace-pre-wrap [&_pre]:break-all"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="bg-muted overflow-x-auto whitespace-pre-wrap break-all rounded-lg p-4 text-xs leading-relaxed">
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
  const pmtiles = usePmtilesUrl(params.slug);
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
    deleteTileset.mutate(tileset.slug, {
      onSuccess: () => router.push("/my-tilesets"),
    });
  }

  function handleLoadPreview() {
    pmtiles.mutate();
  }

  if (isLoading) {
    return <TilesetDetailSkeleton />;
  }

  const displayError = error?.message ?? updateTileset.error?.message ?? deleteTileset.error?.message ?? pmtiles.error?.message;

  if (displayError || !tileset) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
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

  const tileUrl = `${API_URL}/api/tilesets/${tileset.slug}/pmtiles-url`;

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
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex items-start gap-3">
          <Map className="text-primary mt-1 h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            {editState.editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  aria-label="Tileset name"
                  value={editState.name}
                  onChange={(e) => setEditState({ editing: true, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditState({ editing: false });
                  }}
                  className="bg-transparent text-2xl font-bold tracking-tight outline-none border-b border-primary w-full sm:text-3xl"
                />
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={handleRename}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditState({ editing: false })}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tileset.name}</h1>
                {isOwner && (
                  <button
                    onClick={() => setEditState({ editing: true, name: tileset.name })}
                    className="text-muted-foreground hover:text-foreground md:opacity-0 md:group-hover:opacity-100 transition-opacity"
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
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
              {tileset.width && tileset.height && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Dimensions</p>
                  <p className="mt-1 font-medium">{tileset.width} &times; {tileset.height}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Visibility</p>
                <p className="mt-1 font-medium">{tileset.public ? "Public" : "Private"}</p>
              </div>
              <div className="sm:col-span-2">
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
          {pmtiles.data ? (
            <PmtilesPreview
              pmtilesUrl={pmtiles.data}
              imageWidth={tileset.width ?? tileset.tile_size * (1 << tileset.max_zoom)}
              imageHeight={tileset.height ?? tileset.tile_size * (1 << tileset.max_zoom)}
              maxZoom={tileset.max_zoom}
              tileSize={tileset.tile_size}
              projection={tileset.projection as "flat" | "mercator"}
            />
          ) : (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={pmtiles.isPending}
              onClick={handleLoadPreview}
            >
              {pmtiles.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
              ) : (
                "Load Preview"
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
        <div className="mt-8 flex flex-wrap gap-3">
          {isOwner && (
            <>
              <Button variant="secondary" onClick={handleToggleVisibility} className="w-full sm:w-auto">
                {tileset.public ? (
                  <><EyeOff className="mr-2 h-4 w-4" /> Make Private</>
                ) : (
                  <><Eye className="mr-2 h-4 w-4" /> Publish</>
                )}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full sm:w-auto">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete tileset</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &ldquo;{tileset.name}&rdquo;?
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleDelete}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
    </div>
  );
}
