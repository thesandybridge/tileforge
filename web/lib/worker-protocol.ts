/** Scale metadata for accurate measurements */
export interface ScaleMetadata {
  mode?: "pixels_per_unit" | "units_per_tile";
  value?: number;
  unit?: string;
  bounds?: [number, number, number, number]; // [west, south, east, north]
}

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
      /** Pre-scale factor (e.g., 0.5 = half size, 2.0 = double) */
      scale?: number;
      /** Background color hex string (e.g., "#ffffff") */
      backgroundColor?: string;
      /** Scale metadata for measurements */
      scaleMetadata?: ScaleMetadata;
      /** Whether to also generate PMTiles output */
      includePmtiles?: boolean;
    };

/** Messages sent from the worker to the main thread */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; tilesDone: number; tilesTotal: number; zoom: number }
  | { type: "complete"; zipBytes: ArrayBuffer; pmtilesBytes?: ArrayBuffer }
  | { type: "error"; message: string };
