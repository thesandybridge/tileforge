/** Messages sent from the main thread to the worker */
export type WorkerRequest =
  | { type: "init" }
  | {
      type: "process";
      imageBytes: ArrayBuffer;
      tileSize: number;
      minZoom?: number;
      maxZoom?: number;
      projection?: "flat" | "mercator";
    };

/** Messages sent from the worker to the main thread */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; tilesDone: number; tilesTotal: number; zoom: number }
  | { type: "complete"; zipBytes: ArrayBuffer }
  | { type: "error"; message: string };
