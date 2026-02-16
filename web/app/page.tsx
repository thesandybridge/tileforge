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
  const { status, progress, zipBlob, error, process, reset } = useTileforge();
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

  const isReady = status === "ready" || status === "done" || status === "error";

  return (
    <div className="py-20">
      <div className="mx-auto max-w-lg px-4">
      <h1 className="text-2xl font-bold tracking-tight">Tileforge</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Slice images into XYZ tile sets — entirely in your browser.
      </p>

      {(status === "idle" || status === "loading") && (
        <p className="text-muted-foreground text-sm">Loading WASM engine...</p>
      )}

      {isReady && (
        <div className="space-y-4">
          {/* Drop zone */}
          <Card
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`cursor-pointer border-dashed transition-colors ${
              dragging ? "border-primary bg-primary/5" : ""
            }`}
          >
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Upload className="text-muted-foreground mb-3 h-8 w-8" />
              {fileName ? (
                <div>
                  <p className="text-sm font-medium">{fileName}</p>
                  {imageInfo && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {imageInfo.width} x {imageInfo.height} — ~{Math.round(imageInfo.decodedMB)} MB decoded
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm">Drop an image here or</p>
                  <label className="text-primary cursor-pointer text-sm underline">
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
                </div>
              )}
            </CardContent>
          </Card>

          {memoryWarning && (
            <p className="text-sm text-yellow-500">
              This image requires ~{Math.round(imageInfo!.decodedMB)} MB of memory to decode.
              Processing may fail on devices with limited RAM.
            </p>
          )}

          {/* Config */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm">Tile size</label>
              <Select value={tileSize} onValueChange={setTileSize}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="128">128</SelectItem>
                  <SelectItem value="256">256</SelectItem>
                  <SelectItem value="512">512</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm">Max zoom</label>
              <Select value={maxZoom} onValueChange={setMaxZoom}>
                <SelectTrigger className="w-24">
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

            <div className="flex items-center gap-2">
              <label className="text-sm">Projection</label>
              <Select value={projection} onValueChange={(v) => setProjection(v as "flat" | "mercator")}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="mercator">Mercator</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {imageInfo && (
              <p className="text-muted-foreground text-xs">
                {totalTiles} tiles
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={onProcess}
              disabled={!hasFile || status !== "ready"}
            >
              Process
            </Button>
            {status === "done" && zipBlob && (
              <Button variant="secondary" onClick={onDownload}>
                Download ZIP ({(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)
              </Button>
            )}
            {(status === "done" || status === "error") && (
              <Button variant="outline" onClick={onReset}>
                Reset
              </Button>
            )}
          </div>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}
        </div>
      )}

      {/* Progress */}
      {status === "processing" && (
        <div className="space-y-2">
          <Progress value={progress?.percent ?? 0} />
          <p className="text-muted-foreground text-xs">
            {progress
              ? `Zoom ${progress.zoom} — ${progress.tilesDone}/${progress.tilesTotal} tiles (${Math.round(progress.percent)}%)`
              : "Starting…"}
          </p>
        </div>
      )}

      </div>

      {/* Tile preview — full width */}
      {status === "done" && zipBlob && imageInfo && (
        <div className="mx-auto max-w-6xl px-4">
          <TilePreview
            zipBlob={zipBlob}
            imageWidth={imageInfo.width}
            imageHeight={imageInfo.height}
            maxZoom={mz}
            tileSize={ts}
          />
        </div>
      )}
    </div>
  );
}
