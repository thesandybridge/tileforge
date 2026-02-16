let wasm_bindgen = (function(exports) {
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }

    class WasmTileConfig {
        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            WasmTileConfigFinalization.unregister(this);
            return ptr;
        }
        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_wasmtileconfig_free(ptr, 0);
        }
        /**
         * @param {number} tile_size
         */
        constructor(tile_size) {
            const ret = wasm.wasmtileconfig_new(tile_size);
            this.__wbg_ptr = ret >>> 0;
            WasmTileConfigFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * @param {number} z
         */
        setMaxZoom(z) {
            wasm.wasmtileconfig_setMaxZoom(this.__wbg_ptr, z);
        }
        /**
         * @param {number} z
         */
        setMinZoom(z) {
            wasm.wasmtileconfig_setMinZoom(this.__wbg_ptr, z);
        }
        /**
         * Set projection: 0 = Flat (default), 1 = Mercator.
         * @param {number} p
         */
        setProjection(p) {
            wasm.wasmtileconfig_setProjection(this.__wbg_ptr, p);
        }
    }
    if (Symbol.dispose) WasmTileConfig.prototype[Symbol.dispose] = WasmTileConfig.prototype.free;
    exports.WasmTileConfig = WasmTileConfig;

    /**
     * @param {number} width
     * @param {number} height
     * @param {number} tile_size
     * @returns {number}
     */
    function calcMaxZoom(width, height, tile_size) {
        const ret = wasm.calcMaxZoom(width, height, tile_size);
        return ret >>> 0;
    }
    exports.calcMaxZoom = calcMaxZoom;

    /**
     * @param {number} min_zoom
     * @param {number} max_zoom
     * @returns {number}
     */
    function calcTotalTiles(min_zoom, max_zoom) {
        const ret = wasm.calcTotalTiles(min_zoom, max_zoom);
        return ret >>> 0;
    }
    exports.calcTotalTiles = calcTotalTiles;

    /**
     * Process image bytes into a zip archive of tiles.
     * `on_progress` is called with (tiles_done, tiles_total, current_zoom).
     * @param {Uint8Array} image_bytes
     * @param {WasmTileConfig} config
     * @param {Function} on_progress
     * @returns {Uint8Array}
     */
    function processTiles(image_bytes, config, on_progress) {
        const ptr0 = passArray8ToWasm0(image_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(config, WasmTileConfig);
        var ptr1 = config.__destroy_into_raw();
        const ret = wasm.processTiles(ptr0, len0, ptr1, on_progress);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    exports.processTiles = processTiles;

    function __wbg_get_imports() {
        const import0 = {
            __proto__: null,
            __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
                const ret = Error(getStringFromWasm0(arg0, arg1));
                return ret;
            },
            __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
                throw new Error(getStringFromWasm0(arg0, arg1));
            },
            __wbg_call_e8c868596c950cf6: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
                const ret = arg0.call(arg1, arg2, arg3, arg4);
                return ret;
            }, arguments); },
            __wbindgen_cast_0000000000000001: function(arg0) {
                // Cast intrinsic for `F64 -> Externref`.
                const ret = arg0;
                return ret;
            },
            __wbindgen_init_externref_table: function() {
                const table = wasm.__wbindgen_externrefs;
                const offset = table.grow(4);
                table.set(0, undefined);
                table.set(offset + 0, undefined);
                table.set(offset + 1, null);
                table.set(offset + 2, true);
                table.set(offset + 3, false);
            },
        };
        return {
            __proto__: null,
            "./tileforge_wasm_bg.js": import0,
        };
    }

    const WasmTileConfigFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_wasmtileconfig_free(ptr >>> 0, 1));

    function addToExternrefTable0(obj) {
        const idx = wasm.__externref_table_alloc();
        wasm.__wbindgen_externrefs.set(idx, obj);
        return idx;
    }

    function _assertClass(instance, klass) {
        if (!(instance instanceof klass)) {
            throw new Error(`expected instance of ${klass.name}`);
        }
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return decodeText(ptr, len);
    }

    let cachedUint8ArrayMemory0 = null;
    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function handleError(f, args) {
        try {
            return f.apply(this, args);
        } catch (e) {
            const idx = addToExternrefTable0(e);
            wasm.__wbindgen_exn_store(idx);
        }
    }

    function passArray8ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 1, 1) >>> 0;
        getUint8ArrayMemory0().set(arg, ptr / 1);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_externrefs.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    function decodeText(ptr, len) {
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    let WASM_VECTOR_LEN = 0;

    let wasmModule, wasm;
    function __wbg_finalize_init(instance, module) {
        wasm = instance.exports;
        wasmModule = module;
        cachedUint8ArrayMemory0 = null;
        wasm.__wbindgen_start();
        return wasm;
    }

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);
                } catch (e) {
                    const validResponse = module.ok && expectedResponseType(module.type);

                    if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else { throw e; }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);
        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };
            } else {
                return instance;
            }
        }

        function expectedResponseType(type) {
            switch (type) {
                case 'basic': case 'cors': case 'default': return true;
            }
            return false;
        }
    }

    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (module !== undefined) {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();
        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }
        const instance = new WebAssembly.Instance(module, imports);
        return __wbg_finalize_init(instance, module);
    }

    async function __wbg_init(module_or_path) {
        if (wasm !== undefined) return wasm;


        if (module_or_path !== undefined) {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (module_or_path === undefined && script_src !== undefined) {
            module_or_path = script_src.replace(/\.js$/, "_bg.wasm");
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    return Object.assign(__wbg_init, { initSync }, exports);
})({ __proto__: null });
