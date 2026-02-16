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

function process(imageBytes, tileSize, minZoom, maxZoom, projection) {
  if (!ready) {
    post({ type: "error", message: "WASM module not initialized" });
    return;
  }

  try {
    const { WasmTileConfig, processTiles } = wasm_bindgen;
    const config = new WasmTileConfig(tileSize);
    if (minZoom !== undefined) config.setMinZoom(minZoom);
    if (maxZoom !== undefined) config.setMaxZoom(maxZoom);
    if (projection === "mercator") config.setProjection(1);

    const input = new Uint8Array(imageBytes);
    const zipData = processTiles(input, config, function (tilesDone, tilesTotal, zoom) {
      post({ type: "progress", tilesDone: tilesDone, tilesTotal: tilesTotal, zoom: zoom });
    });

    const buffer = zipData.buffer;
    post({ type: "complete", zipBytes: buffer }, [buffer]);
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
      process(msg.imageBytes, msg.tileSize, msg.minZoom, msg.maxZoom, msg.projection);
      break;
  }
};
