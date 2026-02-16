declare namespace wasm_bindgen {
    /* tslint:disable */
    /* eslint-disable */

    export class WasmTileConfig {
        free(): void;
        [Symbol.dispose](): void;
        constructor(tile_size: number);
        setMaxZoom(z: number): void;
        setMinZoom(z: number): void;
        /**
         * Set projection: 0 = Flat (default), 1 = Mercator.
         */
        setProjection(p: number): void;
    }

    export function calcMaxZoom(width: number, height: number, tile_size: number): number;

    export function calcTotalTiles(min_zoom: number, max_zoom: number): number;

    /**
     * Process image bytes into a zip archive of tiles.
     * `on_progress` is called with (tiles_done, tiles_total, current_zoom).
     */
    export function processTiles(image_bytes: Uint8Array, config: WasmTileConfig, on_progress: Function): Uint8Array;

}
declare type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

declare interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmtileconfig_free: (a: number, b: number) => void;
    readonly calcMaxZoom: (a: number, b: number, c: number) => number;
    readonly processTiles: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly wasmtileconfig_new: (a: number) => number;
    readonly wasmtileconfig_setMaxZoom: (a: number, b: number) => void;
    readonly wasmtileconfig_setMinZoom: (a: number, b: number) => void;
    readonly wasmtileconfig_setProjection: (a: number, b: number) => void;
    readonly calcTotalTiles: (a: number, b: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
