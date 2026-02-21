declare namespace wasm_bindgen {
    /* tslint:disable */
    /* eslint-disable */

    /**
     * Result containing both ZIP and PMTiles output bytes.
     */
    export class TileOutput {
        private constructor();
        free(): void;
        [Symbol.dispose](): void;
        readonly pmtilesBytes: Uint8Array;
        readonly zipBytes: Uint8Array;
    }

    export class WasmTileConfig {
        free(): void;
        [Symbol.dispose](): void;
        constructor(tile_size: number);
        /**
         * Set background color as hex string (e.g., "#ffffff" or "#ffffffff" with alpha).
         */
        setBackgroundColor(hex: string): void;
        setMaxZoom(z: number): void;
        setMinZoom(z: number): void;
        /**
         * Set projection: 0 = Flat (default), 1 = Mercator, 2 = Isometric.
         */
        setProjection(p: number): void;
        /**
         * Set pre-scale factor (e.g., 0.5 = half size, 2.0 = double).
         */
        setScale(s: number): void;
        /**
         * Set scale metadata mode: "pixels_per_unit" or "units_per_tile".
         */
        setScaleMode(mode: string): void;
        /**
         * Set scale metadata unit name (e.g., "meters", "feet").
         */
        setScaleUnit(unit: string): void;
        /**
         * Set scale metadata value.
         */
        setScaleValue(value: number): void;
    }

    export function calcMaxZoom(width: number, height: number, tile_size: number): number;

    export function calcTotalTiles(min_zoom: number, max_zoom: number): number;

    /**
     * Process image bytes into a zip archive of tiles.
     * `on_progress` is called with (tiles_done, tiles_total, current_zoom).
     */
    export function processTiles(image_bytes: Uint8Array, config: WasmTileConfig, on_progress: Function): Uint8Array;

    /**
     * Process image bytes into both ZIP and PMTiles archives.
     * `on_progress` is called with (tiles_done, tiles_total, current_zoom).
     */
    export function processTilesWithPmtiles(image_bytes: Uint8Array, config: WasmTileConfig, on_progress: Function): TileOutput;

}
declare type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

declare interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tileoutput_free: (a: number, b: number) => void;
    readonly __wbg_wasmtileconfig_free: (a: number, b: number) => void;
    readonly calcMaxZoom: (a: number, b: number, c: number) => number;
    readonly processTiles: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly processTilesWithPmtiles: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly tileoutput_pmtilesBytes: (a: number) => [number, number];
    readonly tileoutput_zipBytes: (a: number) => [number, number];
    readonly wasmtileconfig_new: (a: number) => number;
    readonly wasmtileconfig_setBackgroundColor: (a: number, b: number, c: number) => void;
    readonly wasmtileconfig_setMaxZoom: (a: number, b: number) => void;
    readonly wasmtileconfig_setMinZoom: (a: number, b: number) => void;
    readonly wasmtileconfig_setProjection: (a: number, b: number) => void;
    readonly wasmtileconfig_setScale: (a: number, b: number) => void;
    readonly wasmtileconfig_setScaleMode: (a: number, b: number, c: number) => void;
    readonly wasmtileconfig_setScaleUnit: (a: number, b: number, c: number) => void;
    readonly wasmtileconfig_setScaleValue: (a: number, b: number) => void;
    readonly calcTotalTiles: (a: number, b: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
declare function wasm_bindgen (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
