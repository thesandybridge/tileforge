"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type TileforgeStatus = "idle" | "loading" | "ready" | "waking" | "processing" | "done" | "error";

export interface TileforgeProgress {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
  percent: number;
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
  const [status, setStatus] = useState<TileforgeStatus>("idle");
  const [progress, setProgress] = useState<TileforgeProgress | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [pmtilesUrl, setPmtilesUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  useEffect(() => {
    const worker = new Worker("/tileforge.worker.js");
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "ready":
          setStatus("ready");
          break;
        case "progress":
          setProgress({
            tilesDone: msg.tilesDone,
            tilesTotal: msg.tilesTotal,
            zoom: msg.zoom,
            percent: (msg.tilesDone / msg.tilesTotal) * 100,
          });
          break;
        case "complete": {
          const blob = new Blob([msg.zipBytes], {
            type: "application/zip",
          });
          setZipBlob(blob);
          setDurationMs(performance.now() - startTimeRef.current);
          setStatus("done");
          setProgress(null);
          break;
        }
        case "error":
          setError(msg.message);
          setStatus("error");
          setProgress(null);
          break;
      }
    };

    setStatus("loading");
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
      setStatus("processing");
      setProgress(null);
      setZipBlob(null);
      setPmtilesUrl(null);
      setError(null);
      setDurationMs(null);

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

  const sseRef = useRef<EventSource | null>(null);

  const processServer = useCallback(
    async (
      imageBytes: ArrayBuffer,
      opts: {
        tileSize?: number;
        minZoom?: number;
        maxZoom?: number;
        projection?: "flat" | "mercator";
      } = {},
    ) => {
      startTimeRef.current = performance.now();
      setProgress(null);
      setZipBlob(null);
      setPmtilesUrl(null);
      setError(null);
      setDurationMs(null);

      // Wake up server if it's sleeping (Railway Serverless)
      setStatus("waking");
      const healthy = await waitForHealth();
      if (!healthy) {
        setError("Server is unavailable. Try local WASM processing instead.");
        setStatus("error");
        return;
      }

      setStatus("processing");

      const params = new URLSearchParams();
      params.set("tile_size", String(opts.tileSize ?? 256));
      if (opts.minZoom != null) params.set("min_zoom", String(opts.minZoom));
      if (opts.maxZoom != null) params.set("max_zoom", String(opts.maxZoom));
      if (opts.projection) params.set("projection", opts.projection);

      try {
        const res = await fetch(`${API_URL}/api/tiles?${params}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: imageBytes,
        });

        if (!res.ok && res.status !== 202) {
          const body = await res.json().catch(() => ({ error: "Server error" }));
          setError(body.error ?? `Server error (${res.status})`);
          setStatus("error");
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
                setProgress({
                  tilesDone: data.tiles_done,
                  tilesTotal: data.tiles_total,
                  zoom: data.zoom ?? 0,
                  percent: data.tiles_total > 0 ? (data.tiles_done / data.tiles_total) * 100 : 0,
                });
              } else if (data.status === "complete" && data.download_url) {
                sse.close();
                sseRef.current = null;
                if (data.pmtiles_url) {
                  setPmtilesUrl(`${API_URL}${data.pmtiles_url}`);
                }
                try {
                  const dlRes = await fetch(`${API_URL}${data.download_url}`);
                  if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
                  const buf = await dlRes.arrayBuffer();
                  setZipBlob(new Blob([buf], { type: "application/zip" }));
                  setDurationMs(performance.now() - startTimeRef.current);
                  setStatus("done");
                  setProgress(null);
                } catch (dlErr) {
                  setError(dlErr instanceof Error ? dlErr.message : "Download failed");
                  setStatus("error");
                  setProgress(null);
                }
              } else if (data.status === "failed") {
                sse.close();
                sseRef.current = null;
                setError(data.error ?? "Processing failed");
                setStatus("error");
                setProgress(null);
              }
            } catch {
              // Ignore parse errors
            }
          };

          sse.onerror = () => {
            sse.close();
            sseRef.current = null;
            setError("Lost connection to server");
            setStatus("error");
            setProgress(null);
          };

          return;
        }

        // Sync path (200): direct ZIP response
        const buf = await res.arrayBuffer();
        setZipBlob(new Blob([buf], { type: "application/zip" }));
        setDurationMs(performance.now() - startTimeRef.current);
        setStatus("done");
      } catch {
        setError("Failed to connect to server");
        setStatus("error");
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus(workerRef.current ? "ready" : "idle");
    setProgress(null);
    setZipBlob(null);
    setPmtilesUrl(null);
    setError(null);
  }, []);

  return { status, progress, zipBlob, pmtilesUrl, error, durationMs, process, processServer, reset };
}
