"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/components/notification-context";
import { useRateLimit } from "@/hooks/use-rate-limit";
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-protocol";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ---------------------------------------------------------------------------
// Types (re-exported for consumers)
// ---------------------------------------------------------------------------

export type TileforgeStatus = "idle" | "loading" | "ready" | "waking" | "processing" | "done" | "error";

export interface TileforgeProgress {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
  percent: number;
}

export interface ProcessOpts {
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  projection?: "flat" | "mercator";
  fileName?: string;
}

export interface ServerProcessOpts extends ProcessOpts {
  token?: string;
}

// ---------------------------------------------------------------------------
// Batch Queue Types
// ---------------------------------------------------------------------------

export type QueueItemStatus = "queued" | "processing" | "done" | "error";

export interface QueuedFile {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
  imageInfo: { width: number; height: number } | null;
  status: QueueItemStatus;
  progress: TileforgeProgress | null;
  zipBlob: Blob | null;
  pmtilesUrl: string | null;
  error: string | null;
  durationMs: number | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TileforgeState {
  status: TileforgeStatus;
  progress: TileforgeProgress | null;
  zipBlob: Blob | null;
  pmtilesUrl: string | null;
  error: string | null;
  durationMs: number | null;
}

type TileforgeAction =
  | { type: "loading" }
  | { type: "ready" }
  | { type: "waking" }
  | { type: "processing" }
  | { type: "progress"; progress: TileforgeProgress }
  | { type: "clear_progress" }
  | { type: "complete"; zipBlob: Blob; durationMs: number; pmtilesUrl?: string }
  | { type: "error"; message: string }
  | { type: "set_pmtiles_url"; url: string }
  | { type: "reset"; workerReady: boolean };

const initialState: TileforgeState = {
  status: "idle",
  progress: null,
  zipBlob: null,
  pmtilesUrl: null,
  error: null,
  durationMs: null,
};

function reducer(state: TileforgeState, action: TileforgeAction): TileforgeState {
  switch (action.type) {
    case "loading":
      return { ...initialState, status: "loading" };
    case "ready":
      return { ...state, status: "ready" };
    case "waking":
      return { ...initialState, status: "waking" };
    case "processing":
      return { ...initialState, status: "processing" };
    case "progress":
      return { ...state, progress: action.progress };
    case "clear_progress":
      return { ...state, progress: null };
    case "complete":
      return {
        ...state,
        status: "done",
        zipBlob: action.zipBlob,
        durationMs: action.durationMs,
        pmtilesUrl: action.pmtilesUrl ?? state.pmtilesUrl,
        progress: null,
      };
    case "error":
      return { ...initialState, status: "error", error: action.message };
    case "set_pmtiles_url":
      return { ...state, pmtilesUrl: action.url };
    case "reset":
      return { ...initialState, status: action.workerReady ? "ready" : "idle" };
    default:
      return state;
  }
}

async function waitForHealth(signal?: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${API_URL}/health`, { signal });
      if (res.ok) return true;
    } catch {
      // Service may be cold booting
    }
    if (signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface TileforgeContextValue {
  status: TileforgeStatus;
  progress: TileforgeProgress | null;
  zipBlob: Blob | null;
  pmtilesUrl: string | null;
  error: string | null;
  durationMs: number | null;
  processing: boolean;
  process: (imageBytes: ArrayBuffer, opts?: ProcessOpts) => void;
  processServer: (imageBytes: ArrayBuffer, opts?: ServerProcessOpts) => void;
  reset: () => void;
  // Batch queue
  queue: QueuedFile[];
  addToQueue: (file: File, imageInfo?: { width: number; height: number } | null) => Promise<string>;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  processQueue: (opts: ServerProcessOpts) => void;
  isProcessingQueue: boolean;
}

const TileforgeContext = createContext<TileforgeContextValue>({
  status: "idle",
  progress: null,
  zipBlob: null,
  pmtilesUrl: null,
  error: null,
  durationMs: null,
  processing: false,
  process: () => {},
  processServer: () => {},
  reset: () => {},
  queue: [],
  addToQueue: async () => "",
  removeFromQueue: () => {},
  clearQueue: () => {},
  processQueue: () => {},
  isProcessingQueue: false,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TileforgeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { add } = useNotifications();
  const { updateFromHeaders } = useRateLimit();
  const workerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number>(0);
  const sseRef = useRef<EventSource | null>(null);
  const fileNameRef = useRef<string | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);

  // Batch queue state
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const queueAbortRef = useRef<AbortController | null>(null);

  // Track previous status for notifications
  const prevStatusRef = useRef(state.status);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = state.status;
    prevStatusRef.current = curr;

    if (prev === "processing" && curr === "done" && state.zipBlob) {
      const zipUrl = URL.createObjectURL(state.zipBlob);
      add({
        type: "processing_complete",
        title: "Processing complete!",
        message: "Your tiles are ready to download.",
        zipUrl,
        pmtilesUrl: state.pmtilesUrl ?? undefined,
        fileName: fileNameRef.current ?? undefined,
      });
    }
    if (prev === "processing" && curr === "error" && state.error) {
      add({
        type: "processing_failed",
        title: "Processing failed",
        message: state.error,
      });
    }
  }, [state.status, state.zipBlob, state.pmtilesUrl, state.error, add]);

  // Boot WASM worker once
  useEffect(() => {
    const worker = new Worker("/tileforge.worker.js");
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "ready":
          dispatch({ type: "ready" });
          break;
        case "progress":
          dispatch({
            type: "progress",
            progress: {
              tilesDone: msg.tilesDone,
              tilesTotal: msg.tilesTotal,
              zoom: msg.zoom,
              percent: (msg.tilesDone / msg.tilesTotal) * 100,
            },
          });
          break;
        case "complete": {
          const blob = new Blob([msg.zipBytes], { type: "application/zip" });
          dispatch({
            type: "complete",
            zipBlob: blob,
            durationMs: performance.now() - startTimeRef.current,
          });
          break;
        }
        case "error":
          dispatch({ type: "error", message: msg.message });
          break;
      }
    };

    dispatch({ type: "loading" });
    const init: WorkerRequest = { type: "init" };
    worker.postMessage(init);

    return () => {
      worker.terminate();
      workerRef.current = null;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, []);

  const process = useCallback(
    (imageBytes: ArrayBuffer, opts: ProcessOpts = {}) => {
      if (!workerRef.current) return;
      fileNameRef.current = opts.fileName ?? null;
      startTimeRef.current = performance.now();
      dispatch({ type: "processing" });

      const msg: WorkerRequest = {
        type: "process",
        imageBytes,
        tileSize: opts.tileSize ?? 256,
        minZoom: opts.minZoom,
        maxZoom: opts.maxZoom,
        projection: opts.projection,
      };
      workerRef.current.postMessage(msg, [imageBytes]);
    },
    [],
  );

  const processServer = useCallback(
    async (imageBytes: ArrayBuffer, opts: ServerProcessOpts = {}) => {
      fileNameRef.current = opts.fileName ?? null;
      startTimeRef.current = performance.now();

      dispatch({ type: "waking" });
      const healthy = await waitForHealth();
      if (!healthy) {
        dispatch({ type: "error", message: "Server is unavailable. Try local WASM processing instead." });
        return;
      }

      dispatch({ type: "processing" });

      const params = new URLSearchParams();
      params.set("tile_size", String(opts.tileSize ?? 256));
      if (opts.minZoom != null) params.set("min_zoom", String(opts.minZoom));
      if (opts.maxZoom != null) params.set("max_zoom", String(opts.maxZoom));
      if (opts.projection) params.set("projection", opts.projection);
      if (opts.fileName) params.set("file_name", opts.fileName);

      try {
        const headers: Record<string, string> = { "content-type": "application/octet-stream" };
        if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
        const res = await fetch(`${API_URL}/api/tiles?${params}`, {
          method: "POST",
          headers,
          body: imageBytes,
        });

        // Track rate limit headers
        updateFromHeaders(res.headers, "tiles");

        if (!res.ok && res.status !== 202) {
          const body = await res.json().catch(() => ({ error: "Server error" }));
          dispatch({ type: "error", message: body.error ?? `Server error (${res.status})` });
          return;
        }

        if (res.status === 202) {
          const { job_id } = (await res.json()) as { job_id: string };

          sseRef.current?.close();

          const sse = new EventSource(`${API_URL}/api/tiles/${job_id}/progress`);
          sseRef.current = sse;

          sse.onmessage = async (e) => {
            try {
              const data = JSON.parse(e.data) as {
                status: string;
                zoom?: number;
                tiles_done?: number;
                tiles_total?: number;
                download_url?: string;
                pmtiles_url?: string;
                error?: string;
              };

              if (data.status === "processing" && data.tiles_done != null && data.tiles_total != null) {
                dispatch({
                  type: "progress",
                  progress: {
                    tilesDone: data.tiles_done,
                    tilesTotal: data.tiles_total,
                    zoom: data.zoom ?? 0,
                    percent: data.tiles_total > 0 ? (data.tiles_done / data.tiles_total) * 100 : 0,
                  },
                });
              } else if (data.status === "generating_pmtiles") {
                dispatch({ type: "clear_progress" });
              } else if (data.status === "complete" && data.download_url) {
                sse.close();
                sseRef.current = null;
                if (data.pmtiles_url) {
                  dispatch({ type: "set_pmtiles_url", url: `${API_URL}${data.pmtiles_url}` });
                }
                try {
                  const dlHeaders: Record<string, string> = {};
                  if (opts.token) dlHeaders["authorization"] = `Bearer ${opts.token}`;
                  const dlRes = await fetch(`${API_URL}${data.download_url}`, { headers: dlHeaders });
                  if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
                  const buf = await dlRes.arrayBuffer();
                  dispatch({
                    type: "complete",
                    zipBlob: new Blob([buf], { type: "application/zip" }),
                    durationMs: performance.now() - startTimeRef.current,
                    pmtilesUrl: data.pmtiles_url ? `${API_URL}${data.pmtiles_url}` : undefined,
                  });
                  queryClient.invalidateQueries({ queryKey: ["user"] });
                  queryClient.invalidateQueries({ queryKey: ["tilesets"] });
                } catch (dlErr) {
                  dispatch({ type: "error", message: dlErr instanceof Error ? dlErr.message : "Download failed" });
                }
              } else if (data.status === "failed") {
                sse.close();
                sseRef.current = null;
                dispatch({ type: "error", message: data.error ?? "Processing failed" });
              }
            } catch {
              // Ignore parse errors
            }
          };

          sse.onerror = () => {
            sse.close();
            sseRef.current = null;
            dispatch({ type: "error", message: "Lost connection to server" });
          };

          return;
        }

        // Sync path (200): direct ZIP response
        const buf = await res.arrayBuffer();
        dispatch({
          type: "complete",
          zipBlob: new Blob([buf], { type: "application/zip" }),
          durationMs: performance.now() - startTimeRef.current,
        });
      } catch {
        dispatch({ type: "error", message: "Failed to connect to server" });
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => {
    dispatch({ type: "reset", workerReady: !!workerRef.current });
  }, []);

  // ---------------------------------------------------------------------------
  // Batch Queue Functions
  // ---------------------------------------------------------------------------

  const addToQueue = useCallback(async (file: File, imageInfo?: { width: number; height: number } | null): Promise<string> => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const buffer = await file.arrayBuffer();

    const queuedFile: QueuedFile = {
      id,
      fileName: file.name,
      buffer,
      imageInfo: imageInfo ?? null,
      status: "queued",
      progress: null,
      zipBlob: null,
      pmtilesUrl: null,
      error: null,
      durationMs: null,
    };

    setQueue((prev) => [...prev, queuedFile]);
    return id;
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    queueAbortRef.current?.abort();
    setQueue([]);
    setIsProcessingQueue(false);
  }, []);

  const updateQueueItem = useCallback((id: string, updates: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const processQueue = useCallback(async (opts: ServerProcessOpts) => {
    if (isProcessingQueue) return;

    const pendingFiles = queue.filter((f) => f.status === "queued");
    if (pendingFiles.length === 0) return;

    setIsProcessingQueue(true);
    queueAbortRef.current = new AbortController();

    // Wait for server to be healthy
    const healthy = await waitForHealth(queueAbortRef.current.signal);
    if (!healthy) {
      setIsProcessingQueue(false);
      return;
    }

    for (const file of pendingFiles) {
      if (queueAbortRef.current.signal.aborted) break;

      updateQueueItem(file.id, { status: "processing", progress: null });

      const params = new URLSearchParams();
      params.set("tile_size", String(opts.tileSize ?? 256));
      if (opts.minZoom != null) params.set("min_zoom", String(opts.minZoom));
      if (opts.maxZoom != null) params.set("max_zoom", String(opts.maxZoom));
      if (opts.projection) params.set("projection", opts.projection);
      params.set("file_name", file.fileName);

      const startTime = performance.now();

      try {
        const headers: Record<string, string> = { "content-type": "application/octet-stream" };
        if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;

        const res = await fetch(`${API_URL}/api/tiles?${params}`, {
          method: "POST",
          headers,
          body: file.buffer,
          signal: queueAbortRef.current.signal,
        });

        updateFromHeaders(res.headers, "tiles");

        if (!res.ok && res.status !== 202) {
          const body = await res.json().catch(() => ({ error: "Server error" }));
          updateQueueItem(file.id, { status: "error", error: body.error ?? `Server error (${res.status})` });
          continue;
        }

        if (res.status === 202) {
          const { job_id } = (await res.json()) as { job_id: string };

          // Poll for progress via SSE
          await new Promise<void>((resolve) => {
            const sse = new EventSource(`${API_URL}/api/tiles/${job_id}/progress`);

            const cleanup = () => {
              sse.close();
              resolve();
            };

            queueAbortRef.current?.signal.addEventListener("abort", cleanup);

            sse.onmessage = async (e) => {
              try {
                const data = JSON.parse(e.data) as {
                  status: string;
                  zoom?: number;
                  tiles_done?: number;
                  tiles_total?: number;
                  download_url?: string;
                  pmtiles_url?: string;
                  error?: string;
                };

                if (data.status === "processing" && data.tiles_done != null && data.tiles_total != null) {
                  updateQueueItem(file.id, {
                    progress: {
                      tilesDone: data.tiles_done,
                      tilesTotal: data.tiles_total,
                      zoom: data.zoom ?? 0,
                      percent: data.tiles_total > 0 ? (data.tiles_done / data.tiles_total) * 100 : 0,
                    },
                  });
                } else if (data.status === "complete" && data.download_url) {
                  cleanup();
                  try {
                    const dlHeaders: Record<string, string> = {};
                    if (opts.token) dlHeaders["authorization"] = `Bearer ${opts.token}`;
                    const dlRes = await fetch(`${API_URL}${data.download_url}`, { headers: dlHeaders });
                    if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
                    const buf = await dlRes.arrayBuffer();
                    updateQueueItem(file.id, {
                      status: "done",
                      zipBlob: new Blob([buf], { type: "application/zip" }),
                      pmtilesUrl: data.pmtiles_url ? `${API_URL}${data.pmtiles_url}` : null,
                      durationMs: performance.now() - startTime,
                      progress: null,
                    });
                  } catch (dlErr) {
                    updateQueueItem(file.id, {
                      status: "error",
                      error: dlErr instanceof Error ? dlErr.message : "Download failed",
                    });
                  }
                } else if (data.status === "failed") {
                  cleanup();
                  updateQueueItem(file.id, { status: "error", error: data.error ?? "Processing failed" });
                }
              } catch {
                // Ignore parse errors
              }
            };

            sse.onerror = () => {
              cleanup();
              updateQueueItem(file.id, { status: "error", error: "Lost connection to server" });
            };
          });
        } else {
          // Sync response
          const buf = await res.arrayBuffer();
          updateQueueItem(file.id, {
            status: "done",
            zipBlob: new Blob([buf], { type: "application/zip" }),
            durationMs: performance.now() - startTime,
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          updateQueueItem(file.id, { status: "error", error: "Failed to connect to server" });
        }
      }
    }

    setIsProcessingQueue(false);
    queryClient.invalidateQueries({ queryKey: ["user"] });
    queryClient.invalidateQueries({ queryKey: ["tilesets"] });

    // Notify completion
    const completed = queue.filter((f) => f.status === "done").length;
    const failed = queue.filter((f) => f.status === "error").length;
    if (completed > 0 || failed > 0) {
      add({
        type: completed > 0 ? "processing_complete" : "processing_failed",
        title: "Batch processing complete",
        message: `${completed} succeeded, ${failed} failed`,
      });
    }
  }, [queue, isProcessingQueue, updateFromHeaders, queryClient, add, updateQueueItem]);

  const processing = state.status === "processing" || state.status === "waking";

  const value = useMemo<TileforgeContextValue>(
    () => ({
      ...state,
      processing,
      process,
      processServer,
      reset,
      queue,
      addToQueue,
      removeFromQueue,
      clearQueue,
      processQueue,
      isProcessingQueue,
    }),
    [state, processing, process, processServer, reset, queue, addToQueue, removeFromQueue, clearQueue, processQueue, isProcessingQueue],
  );

  return (
    <TileforgeContext.Provider value={value}>
      {children}
    </TileforgeContext.Provider>
  );
}

export function useTileforge() {
  return useContext(TileforgeContext);
}
