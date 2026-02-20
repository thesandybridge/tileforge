// Tile size options
export const TILE_SIZES = [128, 256, 512] as const;
export type TileSize = (typeof TILE_SIZES)[number];
export const DEFAULT_TILE_SIZE: TileSize = 256;

// Zoom level limits
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 12;
export const DEFAULT_MIN_ZOOM = 0;
export const DEFAULT_MAX_ZOOM = 4;

// Projection types
export const PROJECTIONS = ["flat", "mercator", "isometric"] as const;
export type Projection = (typeof PROJECTIONS)[number];
export const DEFAULT_PROJECTION: Projection = "flat";

// Byte conversion
export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * 1024;
export const BYTES_PER_GB = 1024 * 1024 * 1024;

// RGBA bytes per pixel (for decoded image size calculation)
export const BYTES_PER_PIXEL = 4;
