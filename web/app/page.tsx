"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Info, LoaderCircle, Upload, Save, Trash2, ChevronDown, Palette, Ruler } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollReveal } from "@/components/scroll-reveal";
import { TileParticles } from "@/components/tile-particles";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { useTileforge } from "@/components/tileforge-context";
import { PLAN_PRO } from "@/lib/plans";
import { useTileDefaults } from "@/hooks/use-tile-defaults";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { usePresets, type Preset } from "@/hooks/use-presets";
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
import { DropAreaSkeleton } from "@/components/tileset-skeleton";
import { RateLimitBanner } from "@/components/rate-limit-banner";
import { BatchQueue } from "@/components/batch-queue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

type DragState = "idle" | "hovering" | "invalid";

interface FormState {
  mode: "local" | "server";
  fileName: string | null;
  imageInfo: ImageInfo | null;
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  projection: "flat" | "mercator" | "isometric";
  hasFile: boolean;
  dragState: DragState;
  // Advanced options
  scale: number | null;
  backgroundColor: string | null;
  includePmtiles: boolean;
  // Scale metadata for measurements
  scaleMode: "none" | "pixels_per_unit" | "units_per_tile";
  scaleValue: number;
  scaleUnit: string;
}

type FormAction =
  | { type: "SET_MODE"; mode: "local" | "server" }
  | { type: "FILE_LOADED"; fileName: string; imageInfo: ImageInfo | null; tileSize: number }
  | { type: "FILE_BUFFERED" }
  | { type: "TILE_SIZE_CHANGED"; tileSize: number }
  | { type: "MIN_ZOOM_CHANGED"; minZoom: number }
  | { type: "MAX_ZOOM_CHANGED"; maxZoom: number }
  | { type: "PROJECTION_CHANGED"; projection: "flat" | "mercator" | "isometric" }
  | { type: "SCALE_CHANGED"; scale: number | null }
  | { type: "BACKGROUND_COLOR_CHANGED"; backgroundColor: string | null }
  | { type: "INCLUDE_PMTILES_CHANGED"; includePmtiles: boolean }
  | { type: "SCALE_MODE_CHANGED"; scaleMode: "none" | "pixels_per_unit" | "units_per_tile" }
  | { type: "SCALE_VALUE_CHANGED"; scaleValue: number }
  | { type: "SCALE_UNIT_CHANGED"; scaleUnit: string }
  | { type: "DRAG_HOVER" }
  | { type: "DRAG_INVALID" }
  | { type: "DRAG_END" }
  | { type: "RESET" };

const initialFormState: FormState = {
  mode: "local",
  fileName: null,
  imageInfo: null,
  tileSize: 256,
  minZoom: 0,
  maxZoom: 4,
  projection: "flat",
  hasFile: false,
  dragState: "idle",
  scale: null,
  backgroundColor: null,
  includePmtiles: true,
  scaleMode: "none",
  scaleValue: 1,
  scaleUnit: "meters",
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "FILE_LOADED": {
      const maxZoom = action.imageInfo
        ? calcMaxZoom(action.imageInfo.width, action.imageInfo.height, action.tileSize)
        : state.maxZoom;
      const minZoom = Math.min(state.minZoom, maxZoom);
      return { ...state, fileName: action.fileName, imageInfo: action.imageInfo, maxZoom, minZoom };
    }
    case "FILE_BUFFERED":
      return { ...state, hasFile: true };
    case "TILE_SIZE_CHANGED": {
      const maxZoom = state.imageInfo
        ? Math.min(state.maxZoom, calcMaxZoom(state.imageInfo.width, state.imageInfo.height, action.tileSize))
        : state.maxZoom;
      const minZoom = Math.min(state.minZoom, maxZoom);
      return { ...state, tileSize: action.tileSize, maxZoom, minZoom };
    }
    case "MIN_ZOOM_CHANGED":
      return { ...state, minZoom: action.minZoom };
    case "MAX_ZOOM_CHANGED":
      return { ...state, maxZoom: action.maxZoom, minZoom: Math.min(state.minZoom, action.maxZoom) };
    case "PROJECTION_CHANGED":
      return { ...state, projection: action.projection };
    case "SCALE_CHANGED":
      return { ...state, scale: action.scale };
    case "BACKGROUND_COLOR_CHANGED":
      return { ...state, backgroundColor: action.backgroundColor };
    case "INCLUDE_PMTILES_CHANGED":
      return { ...state, includePmtiles: action.includePmtiles };
    case "SCALE_MODE_CHANGED":
      return { ...state, scaleMode: action.scaleMode };
    case "SCALE_VALUE_CHANGED":
      return { ...state, scaleValue: action.scaleValue };
    case "SCALE_UNIT_CHANGED":
      return { ...state, scaleUnit: action.scaleUnit };
    case "DRAG_HOVER":
      return state.dragState === "hovering" ? state : { ...state, dragState: "hovering" };
    case "DRAG_INVALID":
      return state.dragState === "invalid" ? state : { ...state, dragState: "invalid" };
    case "DRAG_END":
      return state.dragState === "idle" ? state : { ...state, dragState: "idle" };
    case "RESET":
      return initialFormState;
  }
}

export default function Home() {
  const { status, progress, zipBlob, pmtilesBlob, pmtilesUrl, error, durationMs, process, processServer, reset, cancel, queue, addToQueue, processQueue, cancelQueue, isProcessingQueue } = useTileforge();
  const { data: session } = useSession();
  const { defaults } = useTileDefaults();
  const [form, dispatch] = useReducer(formReducer, defaults, (d) => ({
    ...initialFormState,
    tileSize: d.tileSize,
    minZoom: d.minZoom ?? 0,
    maxZoom: d.maxZoom,
    projection: d.projection,
  }));
  const fileRef = useRef<ArrayBuffer | null>(null);
  const { presets, addPreset, deletePreset, mounted: presetsMounted } = usePresets();
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  const loadPreset = useCallback((preset: Preset) => {
    dispatch({ type: "TILE_SIZE_CHANGED", tileSize: preset.tileSize });
    dispatch({ type: "MIN_ZOOM_CHANGED", minZoom: preset.minZoom });
    dispatch({ type: "MAX_ZOOM_CHANGED", maxZoom: preset.maxZoom });
    dispatch({ type: "PROJECTION_CHANGED", projection: preset.projection });
  }, []);

  const openPresetDialog = useCallback(() => {
    setPresetName("");
    setPresetDialogOpen(true);
  }, []);

  const savePreset = useCallback(() => {
    if (!presetName.trim()) return;
    addPreset({
      name: presetName.trim(),
      tileSize: form.tileSize,
      minZoom: form.minZoom,
      maxZoom: form.maxZoom,
      projection: form.projection,
    });
    setPresetDialogOpen(false);
    setPresetName("");
  }, [addPreset, presetName, form.tileSize, form.minZoom, form.maxZoom, form.projection]);

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

  const handleFiles = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    // Single file: use existing flow
    if (imageFiles.length === 1) {
      handleFile(imageFiles[0]);
      return;
    }

    // Multiple files: add to queue
    for (const file of imageFiles) {
      let imageInfo: { width: number; height: number } | null = null;
      try {
        const info = await readImageDimensions(file);
        imageInfo = { width: info.width, height: info.height };
      } catch {
        // imageInfo stays null
      }
      await addToQueue(file, imageInfo);
    }
  }, [handleFile, addToQueue]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dispatch({ type: "DRAG_END" });
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  // Derived values (not stored in state)
  const calculatedMaxZoom = form.imageInfo
    ? calcMaxZoom(form.imageInfo.width, form.imageInfo.height, form.tileSize)
    : 0;
  const totalTiles = calcTotalTiles(form.minZoom, form.maxZoom);
  const memoryWarning = form.imageInfo && form.imageInfo.decodedMB > 1200;
  const canProcess = form.hasFile && (form.mode === "server" || status === "ready") && status !== "processing" && status !== "waking";
  const showCard = form.mode === "server" || status === "ready" || status === "done" || status === "error" || status === "processing" || status === "waking";

  const onProcess = useCallback(() => {
    if (!fileRef.current) return;
    const copy = fileRef.current.slice(0);
    const scaleMetadata = form.scaleMode !== "none" ? {
      mode: form.scaleMode,
      value: form.scaleValue,
      unit: form.scaleUnit,
    } : undefined;
    const baseOpts = {
      tileSize: form.tileSize,
      minZoom: form.minZoom,
      maxZoom: form.maxZoom,
      projection: form.projection,
      fileName: form.fileName ?? undefined,
      scale: form.scale ?? undefined,
      backgroundColor: form.backgroundColor ?? undefined,
      scaleMetadata,
    };
    if (form.mode === "server") {
      processServer(copy, { ...baseOpts, token: session?.accessToken });
    } else {
      process(copy, { ...baseOpts, includePmtiles: form.includePmtiles });
    }
  }, [process, processServer, form.tileSize, form.minZoom, form.maxZoom, form.projection, form.mode, form.fileName, form.scale, form.backgroundColor, form.includePmtiles, form.scaleMode, form.scaleValue, form.scaleUnit, session?.accessToken]);

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
    const a = document.createElement("a");
    a.download = form.fileName
      ? form.fileName.replace(/\.[^.]+$/, "_tiles.pmtiles")
      : "tiles.pmtiles";

    if (pmtilesBlob) {
      // Local WASM processing - use blob
      const url = URL.createObjectURL(pmtilesBlob);
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } else if (pmtilesUrl) {
      // Server processing - use URL
      a.href = pmtilesUrl;
      a.click();
    }
  }, [pmtilesBlob, pmtilesUrl, form.fileName]);

  const onProcessQueue = useCallback(() => {
    // Pro users get higher concurrency (3 parallel), free users get 1 (sequential)
    const concurrency = session?.user?.plan === PLAN_PRO ? 3 : 1;
    processQueue({
      tileSize: form.tileSize,
      minZoom: form.minZoom,
      maxZoom: form.maxZoom,
      projection: form.projection,
      token: session?.accessToken,
      concurrency,
    });
  }, [processQueue, form.tileSize, form.minZoom, form.maxZoom, form.projection, session?.accessToken, session?.user?.plan]);

  const onReset = useCallback(() => {
    fileRef.current = null;
    dispatch({ type: "RESET" });
    reset();
  }, [reset]);

  // Keyboard shortcuts: Ctrl/Cmd+Enter to process, Escape to reset
  useKeyboardShortcuts({
    onSubmit: canProcess ? onProcess : undefined,
    onEscape: onReset,
    enabled: true,
  });

  return (
    <div className="flex flex-1 flex-col py-16">
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
      <main className="mx-auto mt-10 max-w-2xl px-6 space-y-4">
        <RateLimitBanner />
        {form.mode === "local" && (status === "idle" || status === "loading") && (
          <DropAreaSkeleton />
        )}

        {showCard && (
          <div className="relative overflow-visible">
            <TileParticles active={status === "processing" || status === "waking"} />
            <Card className="relative z-10 border-border/50 corona-glow shadow-lg">
            <CardContent className="space-y-6 p-6 sm:p-8">
              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload image — drag and drop or press Enter to browse"
                onDragOver={(e) => {
                  e.preventDefault();
                  // Check if dragged items contain image files
                  const hasImage = Array.from(e.dataTransfer.items).some(
                    (item) => item.kind === "file" && item.type.startsWith("image/")
                  );
                  dispatch({ type: hasImage ? "DRAG_HOVER" : "DRAG_INVALID" });
                }}
                onDragLeave={() => dispatch({ type: "DRAG_END" })}
                onDrop={onDrop}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    const input = e.currentTarget.querySelector<HTMLInputElement>("input[type=file]");
                    input?.click();
                  }
                }}
                className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  form.dragState === "hovering"
                    ? "border-primary bg-primary/5"
                    : form.dragState === "invalid"
                      ? "border-destructive bg-destructive/5"
                      : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Upload className={`mb-4 h-10 w-10 ${form.dragState === "invalid" ? "text-destructive" : "text-muted-foreground"}`} />
                  {form.dragState === "hovering" ? (
                    <p className="text-primary font-medium">Drop to upload</p>
                  ) : form.dragState === "invalid" ? (
                    <p className="text-destructive font-medium">Only image files allowed</p>
                  ) : form.fileName ? (
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
                        Drop images here or{" "}
                        <label className="text-primary cursor-pointer underline underline-offset-4">
                          browse
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                handleFiles(e.target.files);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </p>
                      <p className="text-muted-foreground/60 mt-1 text-sm">
                        PNG, JPEG, WebP supported — select multiple for batch processing
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

              {/* Presets */}
              {presetsMounted && (
                <div className="flex items-center gap-2">
                  {presets.length > 0 && (
                    <Select onValueChange={(id) => {
                      const preset = presets.find(p => p.id === id);
                      if (preset) loadPreset(preset);
                    }}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Load preset..." />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex items-center justify-between gap-2 w-full">
                              <span>{p.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" size="sm" onClick={openPresetDialog}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save preset
                  </Button>
                  {presets.length > 0 && (
                    <Select onValueChange={(id) => deletePreset(id)}>
                      <SelectTrigger className="w-10 px-2">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            Delete &quot;{p.name}&quot;
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Config */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {session?.user?.plan === PLAN_PRO && (
                  <div className="space-y-2">
                    <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                      Mode
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="size-3 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={4} className="max-w-60">
                            <p><strong>Local</strong> processes in your browser via WASM. Images never leave your machine.</p>
                            <p className="mt-1"><strong>Server</strong> offloads to the API. Faster for large images and higher zoom levels.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </label>
                    <Select value={form.mode} onValueChange={(v) => dispatch({ type: "SET_MODE", mode: v as "local" | "server" })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local</SelectItem>
                        <SelectItem value="server">Server</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                    Tile size
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4} className="max-w-60">
                          Pixel dimensions of each output tile. 256 is standard for most mapping libraries. Use 512 for high-DPI displays.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
                  <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                    Min zoom
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4} className="max-w-60">
                          Lowest zoom level to generate. Zoom 0 is a single tile covering the entire image. Increase to skip low-detail levels.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                  <Select value={String(form.minZoom)} onValueChange={(v) => dispatch({ type: "MIN_ZOOM_CHANGED", minZoom: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue placeholder="0" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: form.maxZoom + 1 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {String(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                    Max zoom
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4} className="max-w-60">
                          Highest zoom level to generate. Each level quadruples the tile count. Higher values give more detail but take longer to process.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                  <Select value={String(form.maxZoom)} onValueChange={(v) => dispatch({ type: "MAX_ZOOM_CHANGED", maxZoom: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue placeholder="0" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: form.mode === "server" ? 13 : 9 }, (_, i) => (
                        <SelectItem
                          key={i}
                          value={String(i)}
                          disabled={(form.mode === "local" && form.imageInfo ? i > calculatedMaxZoom : false) || i < form.minZoom}
                        >
                          {String(i)}{form.mode === "local" && form.imageInfo && i === calculatedMaxZoom ? " (max)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                    Projection
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4} className="max-w-72">
                          <p><strong>Flat</strong> for fantasy maps, floor plans, artwork, and non-geographic images.</p>
                          <p className="mt-1"><strong>Mercator</strong> for real-world geographic maps from equirectangular sources.</p>
                          <p className="mt-1"><strong>Isometric</strong> transforms top-down views into a 2.5D isometric perspective.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                  <Select value={form.projection} onValueChange={(v) => dispatch({ type: "PROJECTION_CHANGED", projection: v as "flat" | "mercator" | "isometric" })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat</SelectItem>
                      <SelectItem value="mercator">Mercator</SelectItem>
                      <SelectItem value="isometric">Isometric</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Advanced Options */}
              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  Advanced Options
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    {/* Pre-scale */}
                    <div className="space-y-2">
                      <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                        Pre-scale
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="size-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4} className="max-w-60">
                              <p>Scale the image before tiling. Use 0.5 to halve the size, 2 to double it.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </label>
                      <Select
                        value={form.scale?.toString() ?? "none"}
                        onValueChange={(v) => dispatch({ type: "SCALE_CHANGED", scale: v === "none" ? null : parseFloat(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (1x)</SelectItem>
                          <SelectItem value="0.25">0.25x (quarter)</SelectItem>
                          <SelectItem value="0.5">0.5x (half)</SelectItem>
                          <SelectItem value="2">2x (double)</SelectItem>
                          <SelectItem value="4">4x (quadruple)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Background Color */}
                    <div className="space-y-2">
                      <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                        Background
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="size-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4} className="max-w-60">
                              <p>Fill transparent areas with a solid color. Leave empty for transparent.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.backgroundColor ?? "#ffffff"}
                          onChange={(e) => dispatch({ type: "BACKGROUND_COLOR_CHANGED", backgroundColor: e.target.value })}
                          className="h-9 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
                          disabled={!form.backgroundColor}
                        />
                        <Button
                          type="button"
                          variant={form.backgroundColor ? "secondary" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => dispatch({
                            type: "BACKGROUND_COLOR_CHANGED",
                            backgroundColor: form.backgroundColor ? null : "#ffffff"
                          })}
                        >
                          {form.backgroundColor ? (
                            <>
                              <Palette className="mr-1.5 h-3.5 w-3.5" />
                              {form.backgroundColor}
                            </>
                          ) : (
                            "Transparent"
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* PMTiles (local mode only) */}
                    {form.mode === "local" && (
                      <div className="space-y-2">
                        <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                          Output Format
                        </label>
                        <div className="flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.includePmtiles}
                              onChange={(e) => dispatch({ type: "INCLUDE_PMTILES_CHANGED", includePmtiles: e.target.checked })}
                              className="h-4 w-4 rounded border-input"
                            />
                            Include PMTiles
                          </label>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          Always includes ZIP. PMTiles is a single-file format for web maps.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Scale Metadata for Measurements */}
                  <div className="space-y-3 border-t border-border/50 pt-4">
                    <label className="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
                      <Ruler className="size-3" />
                      Scale for Measurements
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="size-3 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={4} className="max-w-72">
                            <p>Define how pixels relate to real-world units for accurate measurements.</p>
                            <p className="mt-1"><strong>Pixels per unit:</strong> How many pixels represent one unit (e.g., 10 pixels = 1 meter).</p>
                            <p className="mt-1"><strong>Units per tile:</strong> How many units one tile covers (e.g., 1 tile = 100 meters).</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="scaleMode"
                          checked={form.scaleMode === "none"}
                          onChange={() => dispatch({ type: "SCALE_MODE_CHANGED", scaleMode: "none" })}
                          className="h-4 w-4"
                        />
                        None
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="scaleMode"
                          checked={form.scaleMode === "pixels_per_unit"}
                          onChange={() => dispatch({ type: "SCALE_MODE_CHANGED", scaleMode: "pixels_per_unit" })}
                          className="h-4 w-4"
                        />
                        Pixels per unit
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="scaleMode"
                          checked={form.scaleMode === "units_per_tile"}
                          onChange={() => dispatch({ type: "SCALE_MODE_CHANGED", scaleMode: "units_per_tile" })}
                          className="h-4 w-4"
                        />
                        Units per tile
                      </label>
                    </div>
                    {form.scaleMode !== "none" && (
                      <div className="flex items-center gap-2 text-sm">
                        {form.scaleMode === "pixels_per_unit" ? (
                          <>
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={form.scaleValue || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                dispatch({ type: "SCALE_VALUE_CHANGED", scaleValue: isNaN(val) ? 0 : val });
                              }}
                              className="h-9 w-20 rounded border border-input bg-background px-2 text-center"
                            />
                            <span className="text-muted-foreground">pixels =</span>
                            <span>1</span>
                          </>
                        ) : (
                          <>
                            <span>1 tile =</span>
                            <input
                              type="number"
                              min="0.001"
                              step="any"
                              value={form.scaleValue || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                dispatch({ type: "SCALE_VALUE_CHANGED", scaleValue: isNaN(val) ? 0 : val });
                              }}
                              className="h-9 w-20 rounded border border-input bg-background px-2 text-center"
                            />
                          </>
                        )}
                        <Select
                          value={form.scaleUnit}
                          onValueChange={(v) => dispatch({ type: "SCALE_UNIT_CHANGED", scaleUnit: v })}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="meters">meters</SelectItem>
                            <SelectItem value="feet">feet</SelectItem>
                            <SelectItem value="kilometers">kilometers</SelectItem>
                            <SelectItem value="miles">miles</SelectItem>
                            <SelectItem value="yards">yards</SelectItem>
                            <SelectItem value="inches">inches</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </details>

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

              {/* Batch Queue */}
              {queue.length > 0 && (
                <BatchQueue
                  onProcessAll={onProcessQueue}
                  disabled={form.mode === "local" || !session?.user}
                />
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                {(status === "processing" || status === "waking") && !isProcessingQueue ? (
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={cancel}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    onClick={onProcess}
                    disabled={!canProcess || isProcessingQueue}
                    className="w-full sm:w-auto"
                  >
                    Process
                  </Button>
                )}
                {status === "done" && zipBlob && (
                  <Button size="lg" variant="secondary" onClick={onDownload} className="flex-1 sm:flex-none">
                    Download ZIP ({(zipBlob.size / (1024 * 1024)).toFixed(1)} MB)
                  </Button>
                )}
                {status === "done" && (pmtilesUrl || pmtilesBlob) && (
                  <Button size="lg" variant="secondary" onClick={onDownloadPmtiles} className="flex-1 sm:flex-none">
                    Download PMTiles
                  </Button>
                )}
                {(status === "done" || status === "error") && (
                  <Button size="lg" variant="outline" onClick={onReset} className="w-full sm:w-auto">
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

      {/* Save Preset Dialog */}
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preset-name">Preset name</Label>
              <Input
                id="preset-name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="My preset"
                onKeyDown={(e) => e.key === "Enter" && savePreset()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPresetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePreset} disabled={!presetName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
