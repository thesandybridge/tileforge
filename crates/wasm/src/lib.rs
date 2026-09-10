use image::{DynamicImage, RgbImage};
use tileforge_core::{
    BackgroundColor, PmTilesTileWriter, Projection, ScaleMetadata, SharedBuffer, StreamingTiler,
    TeeTileWriter, TileConfig, TileFormat, TileWriter, Tiler, ZipTileWriter, STREAMING_THRESHOLD,
};
use wasm_bindgen::prelude::*;

fn should_report_progress(
    tiles_done: u32,
    tiles_total: u32,
    zoom: u32,
    last_tiles: u32,
    last_zoom: Option<u32>,
) -> bool {
    let interval = (tiles_total / 200).max(1);
    tiles_done == tiles_total
        || last_zoom != Some(zoom)
        || tiles_done.saturating_sub(last_tiles) >= interval
}

fn progress_callback<'a>(
    on_progress: &'a js_sys::Function,
) -> impl Fn(tileforge_core::TileProgress) + 'a {
    let last_tiles = std::cell::Cell::new(0u32);
    let last_zoom = std::cell::Cell::new(None);
    move |p| {
        if !should_report_progress(
            p.tiles_done,
            p.tiles_total,
            p.zoom,
            last_tiles.get(),
            last_zoom.get(),
        ) {
            return;
        }

        last_tiles.set(p.tiles_done);
        last_zoom.set(Some(p.zoom));
        let _ = on_progress.call3(
            &JsValue::NULL,
            &p.tiles_done.into(),
            &p.tiles_total.into(),
            &p.zoom.into(),
        );
    }
}

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
    format: TileFormat,
    quality: u8,
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
            format: TileFormat::Png,
            quality: 85,
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

    /// Set projection: 0 = Flat (default), 1 = Mercator, 2 = Isometric.
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

    #[wasm_bindgen(js_name = setFormat)]
    pub fn set_format(&mut self, format: u8) {
        self.format = match format {
            1 => TileFormat::Jpeg,
            2 => TileFormat::Webp,
            _ => TileFormat::Png,
        };
    }

    #[wasm_bindgen(js_name = setQuality)]
    pub fn set_quality(&mut self, quality: u8) {
        self.quality = quality.clamp(1, 100);
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
            2 => Projection::Isometric,
            _ => Projection::Flat,
        };

        let background = self
            .background_color
            .as_ref()
            .and_then(|hex| BackgroundColor::from_hex(hex));

        let scale_metadata =
            if self.scale_mode.is_some() || self.scale_value.is_some() || self.scale_unit.is_some()
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
            format: self.format,
            quality: self.quality,
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
    pub fn zip_bytes(&mut self) -> Vec<u8> {
        // Returning a cloned archive briefly doubles its memory inside the
        // WASM heap. Large local jobs can already occupy hundreds of MB, so
        // move each archive out exactly once while JavaScript takes ownership.
        std::mem::take(&mut self.zip_bytes)
    }

    #[wasm_bindgen(getter, js_name = pmtilesBytes)]
    pub fn pmtiles_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pmtiles_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::{should_report_progress, TileOutput};

    #[test]
    fn output_archives_are_moved_instead_of_cloned() {
        let mut output = TileOutput {
            zip_bytes: vec![1, 2, 3],
            pmtiles_bytes: vec![4, 5],
        };

        assert_eq!(output.zip_bytes(), vec![1, 2, 3]);
        assert!(output.zip_bytes().is_empty());
        assert_eq!(output.pmtiles_bytes(), vec![4, 5]);
        assert!(output.pmtiles_bytes().is_empty());
    }

    #[test]
    fn large_jobs_report_bounded_progress() {
        assert!(should_report_progress(1, 80_000, 8, 0, None));
        assert!(!should_report_progress(2, 80_000, 8, 1, Some(8)));
        assert!(should_report_progress(401, 80_000, 8, 1, Some(8)));
        assert!(should_report_progress(402, 80_000, 7, 401, Some(8)));
        assert!(should_report_progress(80_000, 80_000, 7, 79_999, Some(7)));
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
    let format = core_config.format;
    let tiler = Tiler::new(core_config);
    let buf = std::io::Cursor::new(Vec::new());
    let mut zip_writer = ZipTileWriter::with_format(buf, format);

    let report = progress_callback(on_progress);
    tiler
        .process_bytes(image_bytes, &mut zip_writer, report)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(zip_writer.into_inner().unwrap().into_inner())
}

#[wasm_bindgen(js_name = processRgbTiles)]
pub fn process_rgb_tiles(
    rgb_bytes: Vec<u8>,
    width: u32,
    height: u32,
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<Vec<u8>, JsError> {
    let use_streaming = rgb_bytes.len() > STREAMING_THRESHOLD;
    let image = RgbImage::from_raw(width, height, rgb_bytes)
        .ok_or_else(|| JsError::new("GeoTIFF decoder returned incomplete RGB data"))?;
    let core_config = config.to_core_config();
    let format = core_config.format;
    let mut writer = ZipTileWriter::with_format(std::io::Cursor::new(Vec::new()), format);
    let image = DynamicImage::ImageRgb8(image);
    let report = progress_callback(on_progress);
    if use_streaming {
        StreamingTiler::new(core_config).process_image(&image, &mut writer, report)
    } else {
        Tiler::new(core_config).process_image(&image, &mut writer, report)
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(writer.into_inner().unwrap().into_inner())
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
    let format = core_config.format;
    let min_zoom = core_config.min_zoom.unwrap_or(0) as u8;

    // Calculate max zoom if not specified - use a reasonable default
    // The actual processing will determine the correct value
    let max_zoom = core_config.max_zoom.unwrap_or(8) as u8;

    let tiler = Tiler::new(core_config);

    // Create ZIP writer
    let zip_buf = std::io::Cursor::new(Vec::new());
    let zip_writer = ZipTileWriter::with_format(zip_buf, format);

    // Create PMTiles writer with SharedBuffer so we can extract bytes after finalize
    let pmtiles_buffer = SharedBuffer::new();
    let pmtiles_writer =
        PmTilesTileWriter::with_format(pmtiles_buffer.cursor(), min_zoom, max_zoom, format)
            .map_err(|e| JsError::new(&e.to_string()))?;

    // Create tee writer to write to both
    let mut tee_writer = TeeTileWriter::new(zip_writer, pmtiles_writer);

    let report = progress_callback(on_progress);
    tiler
        .process_bytes(image_bytes, &mut tee_writer, report)
        .map_err(|e| JsError::new(&e.to_string()))?;

    // Finalize both writers (writes PMTiles headers/directory)
    tee_writer
        .finish()
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

#[wasm_bindgen(js_name = processRgbTilesWithPmtiles)]
pub fn process_rgb_tiles_with_pmtiles(
    rgb_bytes: Vec<u8>,
    width: u32,
    height: u32,
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<TileOutput, JsError> {
    let use_streaming = rgb_bytes.len() > STREAMING_THRESHOLD;
    let image = RgbImage::from_raw(width, height, rgb_bytes)
        .ok_or_else(|| JsError::new("GeoTIFF decoder returned incomplete RGB data"))?;
    let core_config = config.to_core_config();
    let format = core_config.format;
    let min_zoom = core_config.min_zoom.unwrap_or(0) as u8;
    let max_zoom = core_config.max_zoom.unwrap_or(8) as u8;
    let zip_writer = ZipTileWriter::with_format(std::io::Cursor::new(Vec::new()), format);
    let pmtiles_buffer = SharedBuffer::new();
    let pmtiles_writer =
        PmTilesTileWriter::with_format(pmtiles_buffer.cursor(), min_zoom, max_zoom, format)
            .map_err(|e| JsError::new(&e.to_string()))?;
    let mut writer = TeeTileWriter::new(zip_writer, pmtiles_writer);
    let image = DynamicImage::ImageRgb8(image);
    let report = progress_callback(on_progress);
    if use_streaming {
        StreamingTiler::new(core_config).process_image(&image, &mut writer, report)
    } else {
        Tiler::new(core_config).process_image(&image, &mut writer, report)
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    writer.finish().map_err(|e| JsError::new(&e.to_string()))?;
    let (zip_writer, _) = writer.into_inner();
    Ok(TileOutput {
        zip_bytes: zip_writer.into_inner().unwrap().into_inner(),
        pmtiles_bytes: pmtiles_buffer.take_bytes(),
    })
}
