use tileforge_core::{Projection, TileConfig, Tiler, ZipTileWriter};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmTileConfig {
    tile_size: u32,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: u8,
}

#[wasm_bindgen]
impl WasmTileConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(tile_size: u32) -> Self {
        Self {
            tile_size,
            min_zoom: None,
            max_zoom: None,
            projection: 0,
        }
    }

    #[wasm_bindgen(js_name = setMinZoom)]
    pub fn set_min_zoom(&mut self, z: u32) {
        self.min_zoom = Some(z);
    }

    #[wasm_bindgen(js_name = setMaxZoom)]
    pub fn set_max_zoom(&mut self, z: u32) {
        self.max_zoom = Some(z);
    }

    /// Set projection: 0 = Flat (default), 1 = Mercator.
    #[wasm_bindgen(js_name = setProjection)]
    pub fn set_projection(&mut self, p: u8) {
        self.projection = p;
    }
}

#[wasm_bindgen(js_name = calcMaxZoom)]
pub fn calc_max_zoom(width: u32, height: u32, tile_size: u32) -> u32 {
    Tiler::calc_max_zoom(width, height, tile_size)
}

#[wasm_bindgen(js_name = calcTotalTiles)]
pub fn calc_total_tiles(min_zoom: u32, max_zoom: u32) -> u32 {
    Tiler::calc_total_tiles(min_zoom, max_zoom)
}

/// Process image bytes into a zip archive of tiles.
/// `on_progress` is called with (tiles_done, tiles_total, current_zoom).
#[wasm_bindgen(js_name = processTiles)]
pub fn process_tiles(
    image_bytes: &[u8],
    config: WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<Vec<u8>, JsError> {
    let projection = match config.projection {
        1 => Projection::Mercator,
        _ => Projection::Flat,
    };
    let core_config = TileConfig {
        tile_size: config.tile_size,
        min_zoom: config.min_zoom,
        max_zoom: config.max_zoom,
        projection,
    };

    let tiler = Tiler::new(core_config);
    let buf = std::io::Cursor::new(Vec::new());
    let mut zip_writer = ZipTileWriter::new(buf);

    let js_this = JsValue::NULL;
    tiler
        .process_bytes(image_bytes, &mut zip_writer, |p| {
            let _ = on_progress.call3(
                &js_this,
                &JsValue::from(p.tiles_done),
                &JsValue::from(p.tiles_total),
                &JsValue::from(p.zoom),
            );
        })
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(zip_writer.into_inner().unwrap().into_inner())
}
