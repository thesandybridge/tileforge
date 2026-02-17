"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type TileforgeStatus = "idle" | "loading" | "ready" | "waking" | "processing" | "done" | "error";

export interface TileforgeProgress {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
  percent: number;
}

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

export function useTileforge() {
  const workerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number>(0);
  const sseRef = useRef<EventSource | null>(null);
  const [state, dispatch] = useReducer(reducer, initialState);

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
    (
      imageBytes: ArrayBuffer,
      opts: {
        tileSize?: number;
        minZoom?: number;
        maxZoom?: number;
        projection?: "flat" | "mercator";
      } = {},
    ) => {
      if (!workerRef.current) return;
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
    async (
      imageBytes: ArrayBuffer,
      opts: {
        tileSize?: number;
        minZoom?: number;
        maxZoom?: number;
        projection?: "flat" | "mercator";
        token?: string;
      } = {},
    ) => {
      startTimeRef.current = performance.now();

      // Wake up server if it's sleeping (Railway Serverless)
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

      try {
        const headers: Record<string, string> = { "content-type": "application/octet-stream" };
        if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
        const res = await fetch(`${API_URL}/api/tiles?${params}`, {
          method: "POST",
          headers,
          body: imageBytes,
        });

        if (!res.ok && res.status !== 202) {
          const body = await res.json().catch(() => ({ error: "Server error" }));
          dispatch({ type: "error", message: body.error ?? `Server error (${res.status})` });
          return;
        }

        if (res.status === 202) {
          // Async path: open SSE for progress
          const { job_id } = (await res.json()) as { job_id: string };

          // Close any existing SSE connection
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
                  const dlRes = await fetch(`${API_URL}${data.download_url}`);
                  if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
                  const buf = await dlRes.arrayBuffer();
                  dispatch({
                    type: "complete",
                    zipBlob: new Blob([buf], { type: "application/zip" }),
                    durationMs: performance.now() - startTimeRef.current,
                    pmtilesUrl: data.pmtiles_url ? `${API_URL}${data.pmtiles_url}` : undefined,
                  });
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
    [],
  );

  const reset = useCallback(() => {
    dispatch({ type: "reset", workerReady: !!workerRef.current });
  }, []);

  return { ...state, process, processServer, reset };
}
