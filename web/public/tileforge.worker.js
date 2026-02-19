importScripts("/wasm/tileforge_wasm.js");

let ready = false;

function post(msg, transfer) {
  self.postMessage(msg, { transfer: transfer || [] });
}

async function init() {
  try {
    await wasm_bindgen("/wasm/tileforge_wasm_bg.wasm");
    ready = true;
    post({ type: "ready" });
  } catch (e) {
    post({ type: "error", message: "WASM init failed: " + (e.message || String(e)) });
  }
}

function process(msg) {
  if (!ready) {
    post({ type: "error", message: "WASM module not initialized" });
    return;
  }

  try {
    const { WasmTileConfig, processTiles, processTilesWithPmtiles } = wasm_bindgen;
    const config = new WasmTileConfig(msg.tileSize);

    // Basic options
    if (msg.minZoom !== undefined) config.setMinZoom(msg.minZoom);
    if (msg.maxZoom !== undefined) config.setMaxZoom(msg.maxZoom);
    if (msg.projection === "mercator") config.setProjection(1);

    // New options
    if (msg.scale !== undefined) config.setScale(msg.scale);
    if (msg.backgroundColor) config.setBackgroundColor(msg.backgroundColor);

    // Scale metadata
    if (msg.scaleMetadata) {
      if (msg.scaleMetadata.mode) config.setScaleMode(msg.scaleMetadata.mode);
      if (msg.scaleMetadata.value !== undefined) config.setScaleValue(msg.scaleMetadata.value);
      if (msg.scaleMetadata.unit) config.setScaleUnit(msg.scaleMetadata.unit);
    }

    const input = new Uint8Array(msg.imageBytes);

    const progressCallback = function (tilesDone, tilesTotal, zoom) {
      post({ type: "progress", tilesDone: tilesDone, tilesTotal: tilesTotal, zoom: zoom });
    };

    if (msg.includePmtiles) {
      // Process with both ZIP and PMTiles output
      const result = processTilesWithPmtiles(input, config, progressCallback);
      const zipBuffer = result.zipBytes.buffer;
      const pmtilesBuffer = result.pmtilesBytes.buffer;

      const transfers = [zipBuffer];
      const response = { type: "complete", zipBytes: zipBuffer };

      if (pmtilesBuffer.byteLength > 0) {
        response.pmtilesBytes = pmtilesBuffer;
        transfers.push(pmtilesBuffer);
      }

      post(response, transfers);
    } else {
      // Process ZIP only (default)
      const zipData = processTiles(input, config, progressCallback);
      const buffer = zipData.buffer;
      post({ type: "complete", zipBytes: buffer }, [buffer]);
    }
  } catch (e) {
    post({ type: "error", message: e.message || String(e) });
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  switch (msg.type) {
    case "init":
      init();
      break;
    case "process":
      process(msg);
      break;
  }
};
