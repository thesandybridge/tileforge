importScripts("/wasm/tileforge_wasm.js?v=9");

let ready = false;

function post(msg, transfer) {
  self.postMessage(msg, { transfer: transfer || [] });
}

async function init() {
  try {
    await wasm_bindgen("/wasm/tileforge_wasm_bg.wasm?v=9");
    ready = true;
    post({ type: "ready" });
  } catch (e) {
    post({ type: "error", message: "WASM init failed: " + (e.message || String(e)) });
  }
}

async function openDiskOutputs(output) {
  if (!navigator.storage?.getDirectory) return null;

  const root = await navigator.storage.getDirectory();
  const wantZip = output === "zip" || output === "both";
  const wantPmtiles = output === "pmtiles" || output === "both";
  const zipFile = wantZip
    ? await root.getFileHandle("tileforge-output.zip", { create: true })
    : null;
  const pmtilesFile = wantPmtiles
    ? await root.getFileHandle("tileforge-output.pmtiles", { create: true })
    : null;

  if (
    (zipFile && typeof zipFile.createSyncAccessHandle !== "function")
    || (pmtilesFile && typeof pmtilesFile.createSyncAccessHandle !== "function")
  ) {
    return null;
  }

  let zipAccess = null;
  let pmtilesAccess = null;
  try {
    zipAccess = zipFile ? await zipFile.createSyncAccessHandle() : null;
    pmtilesAccess = pmtilesFile ? await pmtilesFile.createSyncAccessHandle() : null;
    zipAccess?.truncate(0);
    pmtilesAccess?.truncate(0);
    return { zipFile, pmtilesFile, zipAccess, pmtilesAccess };
  } catch (error) {
    zipAccess?.close();
    pmtilesAccess?.close();
    throw error;
  }
}

async function process(msg) {
  if (!ready) {
    post({ type: "error", message: "WASM module not initialized" });
    return;
  }

  let config;
  try {
    const { WasmTileConfig, processTiles, processTilesWithPmtiles } = wasm_bindgen;
    config = new WasmTileConfig(msg.tileSize);

    // Basic options
    if (msg.minZoom !== undefined) config.setMinZoom(msg.minZoom);
    if (msg.maxZoom !== undefined) config.setMaxZoom(msg.maxZoom);
    if (msg.projection === "mercator") config.setProjection(1);
    else if (msg.projection === "isometric") config.setProjection(2);

    // New options
    if (msg.scale !== undefined) config.setScale(msg.scale);
    if (msg.backgroundColor) config.setBackgroundColor(msg.backgroundColor);
    if (msg.format === "jpeg") config.setFormat(1);
    else if (msg.format === "webp") config.setFormat(2);
    if (msg.quality !== undefined) config.setQuality(msg.quality);

    // Scale metadata
    if (msg.scaleMetadata) {
      if (msg.scaleMetadata.mode) config.setScaleMode(msg.scaleMetadata.mode);
      if (msg.scaleMetadata.value !== undefined) config.setScaleValue(msg.scaleMetadata.value);
      if (msg.scaleMetadata.unit) config.setScaleUnit(msg.scaleMetadata.unit);
    }

    const input = msg.imageBytes ? new Uint8Array(msg.imageBytes) : null;
    const rgb = msg.rgbBytes ? new Uint8Array(msg.rgbBytes) : null;

    const progressCallback = function (tilesDone, tilesTotal, zoom) {
      post({ type: "progress", tilesDone: tilesDone, tilesTotal: tilesTotal, zoom: zoom });
    };

    // Dedicated workers can synchronously write OPFS files. Passing those
    // handles into Rust prevents completed archives from accumulating in the
    // WASM heap. Browsers without this API use the in-memory path below.
    let disk = null;
    try {
      disk = await openDiskOutputs(msg.output || "zip");
    } catch (_) {
      disk = null;
    }

    if (disk) {
      try {
        if (rgb) {
          wasm_bindgen.processRgbTilesToFiles(
            rgb,
            msg.imageWidth,
            msg.imageHeight,
            config,
            progressCallback,
            disk.zipAccess,
            disk.pmtilesAccess,
          );
        } else {
          wasm_bindgen.processTilesToFiles(
            input,
            config,
            progressCallback,
            disk.zipAccess,
            disk.pmtilesAccess,
          );
        }
      } finally {
        disk.zipAccess?.close();
        disk.pmtilesAccess?.close();
      }

      const zipBlob = disk.zipFile ? await disk.zipFile.getFile() : undefined;
      const pmtilesBlob = disk.pmtilesFile ? await disk.pmtilesFile.getFile() : undefined;
      post({ type: "complete", zipBlob, pmtilesBlob });
      return;
    }

    if (msg.output === "both") {
      // Process with both ZIP and PMTiles output
      const result = rgb
        ? wasm_bindgen.processRgbTilesWithPmtiles(rgb, msg.imageWidth, msg.imageHeight, config, progressCallback)
        : processTilesWithPmtiles(input, config, progressCallback);
      let zipBytes;
      let pmtilesBytes;
      try {
        // These getters move the archives out of the WASM heap. Read each only
        // once, then release the now-empty Rust wrapper before posting results.
        zipBytes = result.zipBytes;
        pmtilesBytes = result.pmtilesBytes;
      } finally {
        result.free();
      }
      const zipBuffer = zipBytes.buffer;
      const pmtilesBuffer = pmtilesBytes.buffer;

      const transfers = [zipBuffer];
      const response = { type: "complete", zipBytes: zipBuffer };

      if (pmtilesBuffer.byteLength > 0) {
        response.pmtilesBytes = pmtilesBuffer;
        transfers.push(pmtilesBuffer);
      }

      post(response, transfers);
    } else if (msg.output === "pmtiles") {
      const pmtilesData = rgb
        ? wasm_bindgen.processRgbTilesPmtiles(rgb, msg.imageWidth, msg.imageHeight, config, progressCallback)
        : wasm_bindgen.processTilesPmtiles(input, config, progressCallback);
      const buffer = pmtilesData.buffer;
      post({ type: "complete", pmtilesBytes: buffer }, [buffer]);
    } else {
      // Process ZIP only (default)
      const zipData = rgb
        ? wasm_bindgen.processRgbTiles(rgb, msg.imageWidth, msg.imageHeight, config, progressCallback)
        : processTiles(input, config, progressCallback);
      const buffer = zipData.buffer;
      post({ type: "complete", zipBytes: buffer }, [buffer]);
    }
  } catch (e) {
    post({ type: "error", message: e.message || String(e) });
  } finally {
    config?.free();
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  switch (msg.type) {
    case "init":
      init();
      break;
    case "process":
      void process(msg);
      break;
  }
};
