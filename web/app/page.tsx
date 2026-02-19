"use client";

import { useCallback, useReducer, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { LoaderCircle, Upload } from "lucide-react";
import { ScrollReveal } from "@/components/scroll-reveal";
import { TileParticles } from "@/components/tile-particles";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { useTileforge } from "@/components/tileforge-context";
import { PLAN_PRO } from "@/lib/plans";
import { useTileDefaults } from "@/hooks/use-tile-defaults";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TilePreview = dynamic(() => import("@/components/tile-preview"), {
  ssr: false,
  loading: () => (
    <p className="text-muted-foreground mt-4 text-sm">Loading map preview...</p>
  ),
});

interface ImageInfo {
  width: number;
  height: number;
  decodedMB: number;
}

function readImageDimensions(file: File): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(img.src);
      resolve({ width: w, height: h, decodedMB: (w * h * 4) / (1024 * 1024) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to read image dimensions"));
    };
    img.src = URL.createObjectURL(file);
  });
}

function calcMaxZoom(width: number, height: number, tileSize: number): number {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / tileSize)));
}

function calcTotalTiles(minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const grid = 1 << z;
    total += grid * grid;
  }
  return total;
}

// --- Form state reducer ---

interface FormState {
  mode: "local" | "server";
  fileName: string | null;
  imageInfo: ImageInfo | null;
  tileSize: number;
  maxZoom: number;
  projection: "flat" | "mercator";
  hasFile: boolean;
  dragging: boolean;
}

type FormAction =
  | { type: "SET_MODE"; mode: "local" | "server" }
  | { type: "FILE_LOADED"; fileName: string; imageInfo: ImageInfo | null; tileSize: number }
  | { type: "FILE_BUFFERED" }
  | { type: "TILE_SIZE_CHANGED"; tileSize: number }
  | { type: "MAX_ZOOM_CHANGED"; maxZoom: number }
  | { type: "PROJECTION_CHANGED"; projection: "flat" | "mercator" }
  | { type: "DRAG_START" }
  | { type: "DRAG_END" }
  | { type: "RESET" };

const initialFormState: FormState = {
  mode: "local",
  fileName: null,
  imageInfo: null,
  tileSize: 256,
  maxZoom: 4,
  projection: "flat",
  hasFile: false,
  dragging: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "FILE_LOADED": {
      const maxZoom = action.imageInfo
        ? calcMaxZoom(action.imageInfo.width, action.imageInfo.height, action.tileSize)
        : state.maxZoom;
      return { ...state, fileName: action.fileName, imageInfo: action.imageInfo, maxZoom };
    }
    case "FILE_BUFFERED":
      return { ...state, hasFile: true };
    case "TILE_SIZE_CHANGED": {
      const maxZoom = state.imageInfo
        ? Math.min(state.maxZoom, calcMaxZoom(state.imageInfo.width, state.imageInfo.height, action.tileSize))
        : state.maxZoom;
      return { ...state, tileSize: action.tileSize, maxZoom };
    }
    case "MAX_ZOOM_CHANGED":
      return { ...state, maxZoom: action.maxZoom };
    case "PROJECTION_CHANGED":
      return { ...state, projection: action.projection };
    case "DRAG_START":
      return state.dragging ? state : { ...state, dragging: true };
    case "DRAG_END":
      return state.dragging ? { ...state, dragging: false } : state;
    case "RESET":
      return initialFormState;
  }
}

export default function Home() {
  const { status, progress, zipBlob, pmtilesUrl, error, durationMs, process, processServer, reset } = useTileforge();
  const { data: session } = useSession();
  const { defaults } = useTileDefaults();
  const [form, dispatch] = useReducer(formReducer, defaults, (d) => ({
    ...initialFormState,
    tileSize: d.tileSize,
    maxZoom: d.maxZoom,
    projection: d.projection,
  }));
  const fileRef = useRef<ArrayBuffer | null>(null);

  const handleFile = useCallback(async (file: File) => {
    let imageInfo: ImageInfo | null = null;
    try {
      imageInfo = await readImageDimensions(file);
    } catch {
      // imageInfo stays null
    }
    dispatch({ type: "FILE_LOADED", fileName: file.name, imageInfo, tileSize: form.tileSize });
    const buf = await file.arrayBuffer();
    fileRef.current = buf;
    dispatch({ type: "FILE_BUFFERED" });
  }, [form.tileSize]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ type: "DRAG_END" });
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // Derived values (not stored in state)
  const calculatedMaxZoom = form.imageInfo
    ? calcMaxZoom(form.imageInfo.width, form.imageInfo.height, form.tileSize)
    : 0;
  const totalTiles = calcTotalTiles(0, form.maxZoom);
  const memoryWarning = form.imageInfo && form.imageInfo.decodedMB > 1200;
  const canProcess = form.hasFile && (form.mode === "server" || status === "ready") && status !== "processing" && status !== "waking";
  const showCard = form.mode === "server" || status === "ready" || status === "done" || status === "error" || status === "processing" || status === "waking";

  const onProcess = useCallback(() => {
    if (!fileRef.current) return;
    const copy = fileRef.current.slice(0);
    if (form.mode === "server") {
      processServer(copy, { tileSize: form.tileSize, maxZoom: form.maxZoom, projection: form.projection, token: session?.accessToken, fileName: form.fileName ?? undefined });
    } else {
      process(copy, { tileSize: form.tileSize, maxZoom: form.maxZoom, projection: form.projection, fileName: form.fileName ?? undefined });
    }
  }, [process, processServer, form.tileSize, form.maxZoom, form.projection, form.mode, form.fileName, session?.accessToken]);

  const onDownload = useCallback(() => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = form.fileName
      ? form.fileName.replace(/\.[^.]+$/, "_tiles.zip")
      : "tiles.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [zipBlob, form.fileName]);

  const onDownloadPmtiles = useCallback(() => {
    if (!pmtilesUrl) return;
    const a = document.createElement("a");
    a.href = pmtilesUrl;
    a.download = form.fileName
      ? form.fileName.replace(/\.[^.]+$/, "_tiles.pmtiles")
      : "tiles.pmtiles";
    a.click();
  }, [pmtilesUrl, form.fileName]);

  const onReset = useCallback(() => {
    fileRef.current = null;
    dispatch({ type: "RESET" });
    reset();
  }, [reset]);

  return (
    <div className="py-16">
      {/* Hero */}
      <ScrollReveal>
        <header className="mx-auto max-w-2xl px-6 text-center">
          <div className="inline-flex items-center gap-3">
            <svg
              viewBox="0 0 32 32"
              className="text-primary h-10 w-10 sm:h-12 sm:w-12"
              role="img"
              aria-label="tileforge logo"
            >
              <rect x="5" y="5" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="18" y="5" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="5" y="18" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="19" y="19" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.5" />
            </svg>
            <h1
              className="font-[family-name:var(--font-geist-mono)] text-primary text-4xl font-bold tracking-tight sm:text-5xl"
              style={{ textShadow: "0 0 20px rgba(215,153,33,0.3)" }}
            >
              tileforge
            </h1>
          </div>
          <p className="text-muted-foreground mt-4 text-lg">
            Slice any image into XYZ map tiles — entirely in your browser, powered by WebAssembly.
          </p>
        </header>
      </ScrollReveal>

      <noscript>
        <p className="mx-auto mt-10 max-w-md text-center text-sm text-yellow-500">
          Tileforge requires JavaScript to run. Please enable JavaScript in your browser settings.
        </p>
      </noscript>

      {/* Main tool card */}
      <ScrollReveal className="overflow-visible">
      <main className="mx-auto mt-10 max-w-2xl px-6">
        {form.mode === "local" && (status === "idle" || status === "loading") && (
          <p className="text-muted-foreground text-center text-sm">Loading WASM engine...</p>
        )}

        {showCard && (
          <div className="relative overflow-visible">
            <TileParticles active={status === "processing" || status === "waking"} />
            <Card className="relative z-10 border-border/50 corona-glow shadow-lg">
            <CardContent className="space-y-6 p-6 sm:p-8">
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  dispatch({ type: "DRAG_START" });
                }}
                onDragLeave={() => dispatch({ type: "DRAG_END" })}
                onDrop={onDrop}
                className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors ${
                  form.dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Upload className="text-muted-foreground mb-4 h-10 w-10" />
                  {form.fileName ? (
                    <div>
                      <p className="font-medium">{form.fileName}</p>
                      {form.imageInfo && (
                        <p className="text-muted-foreground mt-1 text-sm">
                          {form.imageInfo.width} &times; {form.imageInfo.height} &mdash; ~{Math.round(form.imageInfo.decodedMB)} MB decoded
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-muted-foreground">
                        Drop an image here or{" "}
                        <label className="text-primary cursor-pointer underline underline-offset-4">
                          browse
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFile(file);
                            }}
                            className="hidden"
                          />
                        </label>
                      </p>
                      <p className="text-muted-foreground/60 mt-1 text-sm">
                        PNG, JPEG, WebP supported
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {memoryWarning && form.imageInfo && (
                <p className="text-sm text-yellow-500">
                  This image requires ~{Math.round(form.imageInfo.decodedMB)} MB of memory to decode.
                  Processing may fail on devices with limited RAM.
                </p>
              )}

              {/* Config */}
              <div className={`grid gap-4 ${session?.user?.plan === PLAN_PRO ? "grid-cols-4" : "grid-cols-3"}`}>
                {session?.user?.plan === PLAN_PRO && (
                  <div className="space-y-2">
                    <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                      Mode
                    </label>
                    <Select value={form.mode} onValueChange={(v) => dispatch({ type: "SET_MODE", mode: v as "local" | "server" })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local WASM</SelectItem>
                        <SelectItem value="server">Server</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Tile size
                  </label>
                  <Select value={String(form.tileSize)} onValueChange={(v) => dispatch({ type: "TILE_SIZE_CHANGED", tileSize: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="128">128</SelectItem>
                      <SelectItem value="256">256</SelectItem>
                      <SelectItem value="512">512</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Max zoom
                  </label>
                  <Select value={String(form.maxZoom)} onValueChange={(v) => dispatch({ type: "MAX_ZOOM_CHANGED", maxZoom: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: form.mode === "server" ? 13 : 9 }, (_, i) => (
                        <SelectItem
                          key={i}
                          value={String(i)}
                          disabled={form.mode === "local" && form.imageInfo ? i > calculatedMaxZoom : false}
                        >
                          {i}{form.mode === "local" && form.imageInfo && i === calculatedMaxZoom ? " (max)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Projection
                  </label>
                  <Select value={form.projection} onValueChange={(v) => dispatch({ type: "PROJECTION_CHANGED", projection: v as "flat" | "mercator" })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat</SelectItem>
                      <SelectItem value="mercator">Mercator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.imageInfo && (
                <p className="text-muted-foreground text-center text-sm">
                  {totalTiles} tiles &mdash; ~{Math.round(form.imageInfo.decodedMB)} MB peak memory
                </p>
              )}

              {/* Waking server */}
              {status === "waking" && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <LoaderCircle className="text-primary h-6 w-6 motion-safe:animate-spin" />
                  <p className="text-muted-foreground text-xs">Waking up server...</p>
                </div>
              )}

              {/* Progress */}
              {status === "processing" && (
                <div className="space-y-2">
                  {progress ? (
                    <>
                      <Progress value={progress.percent} />
                      <p className="text-muted-foreground text-center text-xs">
                        Zoom {progress.zoom} — {progress.tilesDone}/{progress.tilesTotal} tiles ({Math.round(progress.percent)}%)
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-2">
                      <LoaderCircle className="text-primary h-6 w-6 motion-safe:animate-spin" />
                      <p className="text-muted-foreground text-xs">
                        {form.mode === "server" ? "Processing on server..." : "Processing..."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-center gap-3">
                <Button
                  size="lg"
                  onClick={onProcess}
                  disabled={!canProcess}
                >
                  Process
                </Button>
                {status === "done" && zipBlob && (
                  <Button size="lg" variant="secondary" onClick={onDownload}>
                    Download ZIP ({(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)
                  </Button>
                )}
                {status === "done" && pmtilesUrl && (
                  <Button size="lg" variant="secondary" onClick={onDownloadPmtiles}>
                    Download PMTiles
                  </Button>
                )}
                {(status === "done" || status === "error") && (
                  <Button size="lg" variant="outline" onClick={onReset}>
                    Reset
                  </Button>
                )}
              </div>

              {/* Stats */}
              {status === "done" && durationMs != null && form.imageInfo && (
                <p className="text-muted-foreground text-center text-xs">
                  Done in {(durationMs / 1000).toFixed(1)}s &mdash; {totalTiles} tiles &mdash; peak memory ~{Math.round(form.imageInfo.decodedMB)} MB
                </p>
              )}

              {error && (
                <p className="text-destructive text-center text-sm">{error}</p>
              )}
            </CardContent>
          </Card>
          </div>
        )}
      </main>
      </ScrollReveal>

      {/* Upgrade CTA */}
      <div className="mx-auto mt-8 max-w-2xl px-6">
        <ScrollReveal>
          <UpgradeBanner />
        </ScrollReveal>
      </div>

      {/* Tile preview — full width */}
      {status === "done" && zipBlob && form.imageInfo && (
        <div className="mx-auto mt-8 max-w-6xl px-6">
          <TilePreview
            zipBlob={zipBlob}
            imageWidth={form.imageInfo.width}
            imageHeight={form.imageInfo.height}
            maxZoom={form.maxZoom}
            tileSize={form.tileSize}
            projection={form.projection}
          />
        </div>
      )}
      {/* Footer */}
      <footer className="text-muted-foreground mt-16 pb-8 text-center text-sm">
        <Link href="/gallery" className="hover:text-foreground underline underline-offset-4 transition-colors">
          Gallery
        </Link>
        <span className="mx-2">&middot;</span>
        <a href="https://github.com/thesandybridge/tileforge" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4 transition-colors">
          GitHub
        </a>
        <span className="mx-2">&middot;</span>
        &copy; {new Date().getFullYear()} &mdash; made with &hearts; by <a href="https://sandybridge.io" className="hover:text-foreground underline underline-offset-4 transition-colors">sandybridge</a>
      </footer>
    </div>
  );
}
