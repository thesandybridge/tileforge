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
  const [status, setStatus] = useState<TileforgeStatus>("idle");
  const [progress, setProgress] = useState<TileforgeProgress | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setStatus("processing");
      setProgress(null);
      setZipBlob(null);
      setError(null);

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

  const reset = useCallback(() => {
    setStatus(workerRef.current ? "ready" : "idle");
    setProgress(null);
    setZipBlob(null);
    setError(null);
  }, []);

  return { status, progress, zipBlob, error, process, reset };
}
