use tileforge_core::{
    BackgroundColor, PmTilesTileWriter, Projection, ScaleMetadata, SharedBuffer, TeeTileWriter,
    TileConfig, Tiler, ZipTileWriter,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmTileConfig {
    tile_size: u32,
    min_zoom: Option<u32>,
    max_zoom: Option<u32>,
    projection: u8,
    scale: Option<f64>,
    background_color: Option<String>,
    // Scale metadata
    scale_mode: Option<String>,
    scale_value: Option<f64>,
    scale_unit: Option<String>,
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
            scale: None,
            background_color: None,
            scale_mode: None,
            scale_value: None,
            scale_unit: None,
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

    /// Set pre-scale factor (e.g., 0.5 = half size, 2.0 = double).
    #[wasm_bindgen(js_name = setScale)]
    pub fn set_scale(&mut self, s: f64) {
        self.scale = Some(s);
    }

    /// Set background color as hex string (e.g., "#ffffff" or "#ffffffff" with alpha).
    #[wasm_bindgen(js_name = setBackgroundColor)]
    pub fn set_background_color(&mut self, hex: String) {
        self.background_color = Some(hex);
    }

    /// Set scale metadata mode: "pixels_per_unit" or "units_per_tile".
    #[wasm_bindgen(js_name = setScaleMode)]
    pub fn set_scale_mode(&mut self, mode: String) {
        self.scale_mode = Some(mode);
    }

    /// Set scale metadata value.
    #[wasm_bindgen(js_name = setScaleValue)]
    pub fn set_scale_value(&mut self, value: f64) {
        self.scale_value = Some(value);
    }

    /// Set scale metadata unit name (e.g., "meters", "feet").
    #[wasm_bindgen(js_name = setScaleUnit)]
    pub fn set_scale_unit(&mut self, unit: String) {
        self.scale_unit = Some(unit);
    }

    fn to_core_config(&self) -> TileConfig {
        let projection = match self.projection {
            1 => Projection::Mercator,
            _ => Projection::Flat,
        };

        let background = self
            .background_color
            .as_ref()
            .and_then(|hex| BackgroundColor::from_hex(hex));

        let scale_metadata = if self.scale_mode.is_some()
            || self.scale_value.is_some()
            || self.scale_unit.is_some()
        {
            Some(ScaleMetadata {
                mode: self.scale_mode.clone(),
                value: self.scale_value,
                unit: self.scale_unit.clone(),
                bounds: None,
            })
        } else {
            None
        };

        TileConfig {
            tile_size: self.tile_size,
            min_zoom: self.min_zoom,
            max_zoom: self.max_zoom,
            projection,
            scale: self.scale,
            background,
            scale_metadata,
        }
    }
}

/// Result containing both ZIP and PMTiles output bytes.
#[wasm_bindgen]
pub struct TileOutput {
    zip_bytes: Vec<u8>,
    pmtiles_bytes: Vec<u8>,
}

#[wasm_bindgen]
impl TileOutput {
    #[wasm_bindgen(getter, js_name = zipBytes)]
    pub fn zip_bytes(&self) -> Vec<u8> {
        self.zip_bytes.clone()
    }

    #[wasm_bindgen(getter, js_name = pmtilesBytes)]
    pub fn pmtiles_bytes(&self) -> Vec<u8> {
        self.pmtiles_bytes.clone()
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
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<Vec<u8>, JsError> {
    let core_config = config.to_core_config();
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

/// Process image bytes into both ZIP and PMTiles archives.
/// `on_progress` is called with (tiles_done, tiles_total, current_zoom).
#[wasm_bindgen(js_name = processTilesWithPmtiles)]
pub fn process_tiles_with_pmtiles(
    image_bytes: &[u8],
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<TileOutput, JsError> {
    let core_config = config.to_core_config();
    let min_zoom = core_config.min_zoom.unwrap_or(0) as u8;

    // Calculate max zoom if not specified - use a reasonable default
    // The actual processing will determine the correct value
    let max_zoom = core_config.max_zoom.unwrap_or(8) as u8;

    let tiler = Tiler::new(core_config);

    // Create ZIP writer
    let zip_buf = std::io::Cursor::new(Vec::new());
    let zip_writer = ZipTileWriter::new(zip_buf);

    // Create PMTiles writer with SharedBuffer so we can extract bytes after finalize
    let pmtiles_buffer = SharedBuffer::new();
    let pmtiles_writer = PmTilesTileWriter::new(pmtiles_buffer.cursor(), min_zoom, max_zoom)
        .map_err(|e| JsError::new(&e.to_string()))?;

    // Create tee writer to write to both
    let mut tee_writer = TeeTileWriter::new(zip_writer, pmtiles_writer);

    let js_this = JsValue::NULL;
    tiler
        .process_bytes(image_bytes, &mut tee_writer, |p| {
            let _ = on_progress.call3(
                &js_this,
                &JsValue::from(p.tiles_done),
                &JsValue::from(p.tiles_total),
                &JsValue::from(p.zoom),
            );
        })
        .map_err(|e| JsError::new(&e.to_string()))?;

    let (zip_writer, _pmtiles_writer) = tee_writer.into_inner();

    // Get ZIP bytes
    let zip_bytes = zip_writer.into_inner().unwrap().into_inner();

    // Get PMTiles bytes from the shared buffer
    let pmtiles_bytes = pmtiles_buffer.take_bytes();

    Ok(TileOutput {
        zip_bytes,
        pmtiles_bytes,
    })
}
