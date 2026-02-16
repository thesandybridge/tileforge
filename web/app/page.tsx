"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Upload } from "lucide-react";
import { useTileforge } from "@/lib/use-tileforge";
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

export default function Home() {
  const { status, progress, zipBlob, error, durationMs, process, reset } = useTileforge();
  const [fileName, setFileName] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [tileSize, setTileSize] = useState("256");
  const [maxZoom, setMaxZoom] = useState("4");
  const [projection, setProjection] = useState<"flat" | "mercator">("flat");
  const fileRef = useRef<ArrayBuffer | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    try {
      const info = await readImageDimensions(file);
      setImageInfo(info);
      const calculated = calcMaxZoom(info.width, info.height, Number(tileSize));
      setMaxZoom(String(calculated));
    } catch {
      setImageInfo(null);
    }
    const buf = await file.arrayBuffer();
    fileRef.current = buf;
    setHasFile(true);
  }, [tileSize]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const ts = Number(tileSize);
  const mz = Number(maxZoom);
  const calculatedMaxZoom = imageInfo
    ? calcMaxZoom(imageInfo.width, imageInfo.height, ts)
    : 0;
  const totalTiles = calcTotalTiles(0, mz);
  const memoryWarning = imageInfo && imageInfo.decodedMB > 1200;

  const onProcess = useCallback(() => {
    if (!fileRef.current) return;
    const copy = fileRef.current.slice(0);
    process(copy, { tileSize: ts, maxZoom: mz, projection });
  }, [process, ts, mz, projection]);

  const onDownload = useCallback(() => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName
      ? fileName.replace(/\.[^.]+$/, "_tiles.zip")
      : "tiles.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [zipBlob, fileName]);

  const onReset = useCallback(() => {
    fileRef.current = null;
    setHasFile(false);
    setFileName(null);
    setImageInfo(null);
    reset();
  }, [reset]);

  const showCard = status === "ready" || status === "done" || status === "error" || status === "processing";

  return (
    <div className="py-24">
      {/* Hero */}
      <header className="mx-auto max-w-2xl px-6 text-center">
        <div className="inline-flex items-center gap-3">
          <svg
            viewBox="0 0 32 32"
            className="text-primary h-10 w-10 sm:h-12 sm:w-12"
            role="img"
            aria-label="Tileforge logo"
          >
            <rect x="1" y="1" width="13.5" height="13.5" rx="3" fill="currentColor" />
            <rect x="17.5" y="1" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.7" />
            <rect x="1" y="17.5" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.7" />
            <rect x="17.5" y="17.5" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.4" />
          </svg>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Tileforge
          </h1>
        </div>
        <p className="text-muted-foreground mt-4 text-lg">
          Slice any image into XYZ map tiles — entirely in your browser, powered by WebAssembly.
        </p>
      </header>

      <noscript>
        <p className="mx-auto mt-10 max-w-md text-center text-sm text-yellow-500">
          Tileforge requires JavaScript to run. Please enable JavaScript in your browser settings.
        </p>
      </noscript>

      {/* Main tool card */}
      <main className="mx-auto mt-10 max-w-2xl px-6">
        {(status === "idle" || status === "loading") && (
          <p className="text-muted-foreground text-center text-sm">Loading WASM engine...</p>
        )}

        {showCard && (
          <Card className="border-border/50 shadow-lg">
            <CardContent className="space-y-6 p-6 sm:p-8">
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors ${
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Upload className="text-muted-foreground mb-4 h-10 w-10" />
                  {fileName ? (
                    <div>
                      <p className="font-medium">{fileName}</p>
                      {imageInfo && (
                        <p className="text-muted-foreground mt-1 text-sm">
                          {imageInfo.width} &times; {imageInfo.height} &mdash; ~{Math.round(imageInfo.decodedMB)} MB decoded
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

              {memoryWarning && (
                <p className="text-sm text-yellow-500">
                  This image requires ~{Math.round(imageInfo!.decodedMB)} MB of memory to decode.
                  Processing may fail on devices with limited RAM.
                </p>
              )}

              {/* Config */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Tile size
                  </label>
                  <Select value={tileSize} onValueChange={setTileSize}>
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
                  <Select value={maxZoom} onValueChange={setMaxZoom}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 9 }, (_, i) => (
                        <SelectItem
                          key={i}
                          value={String(i)}
                          disabled={imageInfo ? i > calculatedMaxZoom : false}
                        >
                          {i}{imageInfo && i === calculatedMaxZoom ? " (max)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Projection
                  </label>
                  <Select value={projection} onValueChange={(v) => setProjection(v as "flat" | "mercator")}>
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

              {imageInfo && (
                <p className="text-muted-foreground text-center text-sm">
                  {totalTiles} tiles &mdash; ~{Math.round(imageInfo.decodedMB)} MB peak memory
                </p>
              )}

              {/* Progress */}
              {status === "processing" && (
                <div className="space-y-2">
                  <Progress value={progress?.percent ?? 0} />
                  <p className="text-muted-foreground text-center text-xs">
                    {progress
                      ? `Zoom ${progress.zoom} — ${progress.tilesDone}/${progress.tilesTotal} tiles (${Math.round(progress.percent)}%)`
                      : "Starting..."}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-center gap-3">
                <Button
                  size="lg"
                  onClick={onProcess}
                  disabled={!hasFile || status !== "ready"}
                >
                  Process
                </Button>
                {status === "done" && zipBlob && (
                  <Button size="lg" variant="secondary" onClick={onDownload}>
                    Download ZIP ({(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)
                  </Button>
                )}
                {(status === "done" || status === "error") && (
                  <Button size="lg" variant="outline" onClick={onReset}>
                    Reset
                  </Button>
                )}
              </div>

              {/* Stats */}
              {status === "done" && durationMs != null && imageInfo && (
                <p className="text-muted-foreground text-center text-xs">
                  Done in {(durationMs / 1000).toFixed(1)}s &mdash; {totalTiles} tiles &mdash; peak memory ~{Math.round(imageInfo.decodedMB)} MB
                </p>
              )}

              {error && (
                <p className="text-destructive text-center text-sm">{error}</p>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Tile preview — full width */}
      {status === "done" && zipBlob && imageInfo && (
        <div className="mx-auto mt-8 max-w-6xl px-6">
          <TilePreview
            zipBlob={zipBlob}
            imageWidth={imageInfo.width}
            imageHeight={imageInfo.height}
            maxZoom={mz}
            tileSize={ts}
            projection={projection}
          />
        </div>
      )}
      {/* Footer */}
      <footer className="text-muted-foreground mt-16 pb-8 text-center text-sm">
        &copy; {new Date().getFullYear()} &mdash; made with &hearts; by sandybridge
      </footer>
    </div>
  );
}
