"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

export type TileforgeStatus = "idle" | "loading" | "ready" | "processing" | "done" | "error";

export interface TileforgeProgress {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
  percent: number;
}

export function useTileforge() {
  const workerRef = useRef<Worker | null>(null);
  const startTimeRef = useRef<number>(0);
  const [status, setStatus] = useState<TileforgeStatus>("idle");
  const [progress, setProgress] = useState<TileforgeProgress | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
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
      setStatus("processing");
      setProgress(null);
      setZipBlob(null);
      setError(null);
      setDurationMs(null);

      const params = new URLSearchParams();
      params.set("tile_size", String(opts.tileSize ?? 256));
      if (opts.minZoom != null) params.set("min_zoom", String(opts.minZoom));
      if (opts.maxZoom != null) params.set("max_zoom", String(opts.maxZoom));
      if (opts.projection) params.set("projection", opts.projection);

      try {
        const res = await fetch(`/api/tiles?${params}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: imageBytes,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Server error" }));
          setError(body.error ?? `Server error (${res.status})`);
          setStatus("error");
          return;
        }

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
    setError(null);
  }, []);

  return { status, progress, zipBlob, error, durationMs, process, processServer, reset };
}
