use image::{DynamicImage, RgbImage};
use js_sys::{Function, Object, Reflect, Uint8Array};
use std::io::{Seek, SeekFrom, Write};
use tileforge_core::{
    BackgroundColor, PmTilesTileWriter, Projection, ScaleMetadata, SharedBuffer, StreamingTiler,
    TeeTileWriter, TileConfig, TileFormat, TileWriter, Tiler, ZipTileWriter, STREAMING_THRESHOLD,
};
use wasm_bindgen::prelude::*;

struct BrowserFile {
    handle: JsValue,
    position: u64,
}

impl BrowserFile {
    fn new(handle: JsValue) -> Self {
        Self {
            handle,
            position: 0,
        }
    }

    fn call(&self, name: &str, args: &js_sys::Array) -> std::io::Result<JsValue> {
        let method = Reflect::get(&self.handle, &JsValue::from_str(name))
            .map_err(js_io_error)?
            .dyn_into::<Function>()
            .map_err(|_| std::io::Error::other(format!("OPFS handle has no {name} method")))?;
        Reflect::apply(&method, &self.handle, args).map_err(js_io_error)
    }
}

fn js_io_error(value: JsValue) -> std::io::Error {
    let message = value
        .as_string()
        .or_else(|| {
            Reflect::get(&value, &JsValue::from_str("message"))
                .ok()?
                .as_string()
        })
        .unwrap_or_else(|| "OPFS write failed".to_string());
    std::io::Error::other(message)
}

impl Write for BrowserFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let options = Object::new();
        Reflect::set(
            &options,
            &JsValue::from_str("at"),
            &JsValue::from_f64(self.position as f64),
        )
        .map_err(js_io_error)?;
        // FileSystemSyncAccessHandle.write completes synchronously, so the
        // temporary zero-copy view remains valid for the entire call.
        let view = unsafe { Uint8Array::view(buf) };
        let args = js_sys::Array::of2(&view, &options);
        let written = self
            .call("write", &args)?
            .as_f64()
            .ok_or_else(|| std::io::Error::other("OPFS write returned no byte count"))?
            as usize;
        self.position = self.position.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.call("flush", &js_sys::Array::new())?;
        Ok(())
    }
}

impl Seek for BrowserFile {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(offset) => offset as i128,
            SeekFrom::Current(offset) => self.position as i128 + offset as i128,
            SeekFrom::End(offset) => {
                let size = self
                    .call("getSize", &js_sys::Array::new())?
                    .as_f64()
                    .ok_or_else(|| std::io::Error::other("OPFS getSize returned no size"))?;
                size as i128 + offset as i128
            }
        };
        if next < 0 || next > u64::MAX as i128 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid OPFS seek",
            ));
        }
        self.position = next as u64;
        Ok(self.position)
    }
}

enum BrowserArchiveWriter {
    Zip(ZipTileWriter<BrowserFile>),
    Pmtiles(PmTilesTileWriter<BrowserFile>),
    Both(TeeTileWriter<ZipTileWriter<BrowserFile>, PmTilesTileWriter<BrowserFile>>),
}

impl TileWriter for BrowserArchiveWriter {
    fn write_tile(
        &mut self,
        zoom: u32,
        x: u32,
        y: u32,
        bytes: &[u8],
    ) -> Result<(), tileforge_core::TilerError> {
        match self {
            Self::Zip(writer) => writer.write_tile(zoom, x, y, bytes),
            Self::Pmtiles(writer) => writer.write_tile(zoom, x, y, bytes),
            Self::Both(writer) => writer.write_tile(zoom, x, y, bytes),
        }
    }

    fn finish(&mut self) -> Result<(), tileforge_core::TilerError> {
        match self {
            Self::Zip(writer) => writer.finish(),
            Self::Pmtiles(writer) => writer.finish(),
            Self::Both(writer) => writer.finish(),
        }
    }
}

fn browser_writer(
    config: &TileConfig,
    zip_handle: Option<JsValue>,
    pmtiles_handle: Option<JsValue>,
) -> Result<BrowserArchiveWriter, JsError> {
    let min_zoom = config.min_zoom.unwrap_or(0) as u8;
    let max_zoom = config.max_zoom.unwrap_or(8) as u8;
    match (zip_handle, pmtiles_handle) {
        (Some(zip), Some(pmtiles)) => {
            let zip = ZipTileWriter::with_format(BrowserFile::new(zip), config.format);
            let pmtiles = PmTilesTileWriter::with_format(
                BrowserFile::new(pmtiles),
                min_zoom,
                max_zoom,
                config.format,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
            Ok(BrowserArchiveWriter::Both(TeeTileWriter::new(zip, pmtiles)))
        }
        (Some(zip), None) => Ok(BrowserArchiveWriter::Zip(ZipTileWriter::with_format(
            BrowserFile::new(zip),
            config.format,
        ))),
        (None, Some(pmtiles)) => PmTilesTileWriter::with_format(
            BrowserFile::new(pmtiles),
            min_zoom,
            max_zoom,
            config.format,
        )
        .map(BrowserArchiveWriter::Pmtiles)
        .map_err(|error| JsError::new(&error.to_string())),
        (None, None) => Err(JsError::new("No OPFS output handle was provided")),
    }
}

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

/// Process encoded image bytes while writing archives directly to synchronous
/// OPFS handles owned by the worker.
#[wasm_bindgen(js_name = processTilesToFiles)]
pub fn process_tiles_to_files(
    image_bytes: &[u8],
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
    zip_handle: Option<JsValue>,
    pmtiles_handle: Option<JsValue>,
) -> Result<(), JsError> {
    let core_config = config.to_core_config();
    let mut writer = browser_writer(&core_config, zip_handle, pmtiles_handle)?;
    Tiler::new(core_config)
        .process_bytes(image_bytes, &mut writer, progress_callback(on_progress))
        .map_err(|error| JsError::new(&error.to_string()))
        .map(|_| ())
}

/// GeoTIFF/RGB variant of `processTilesToFiles`.
#[wasm_bindgen(js_name = processRgbTilesToFiles)]
pub fn process_rgb_tiles_to_files(
    rgb_bytes: Vec<u8>,
    width: u32,
    height: u32,
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
    zip_handle: Option<JsValue>,
    pmtiles_handle: Option<JsValue>,
) -> Result<(), JsError> {
    let use_streaming = rgb_bytes.len() > STREAMING_THRESHOLD;
    let image = RgbImage::from_raw(width, height, rgb_bytes)
        .ok_or_else(|| JsError::new("GeoTIFF decoder returned incomplete RGB data"))?;
    let core_config = config.to_core_config();
    let mut writer = browser_writer(&core_config, zip_handle, pmtiles_handle)?;
    let image = DynamicImage::ImageRgb8(image);
    let result = if use_streaming {
        StreamingTiler::new(core_config).process_image(
            &image,
            &mut writer,
            progress_callback(on_progress),
        )
    } else {
        Tiler::new(core_config).process_image(&image, &mut writer, progress_callback(on_progress))
    };
    result
        .map_err(|error| JsError::new(&error.to_string()))
        .map(|_| ())
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

/// Process image bytes directly into a PMTiles archive without also retaining
/// a ZIP copy. This is the lowest-memory archive option for browser jobs.
#[wasm_bindgen(js_name = processTilesPmtiles)]
pub fn process_tiles_pmtiles(
    image_bytes: &[u8],
    config: &WasmTileConfig,
    on_progress: &js_sys::Function,
) -> Result<Vec<u8>, JsError> {
    let core_config = config.to_core_config();
    let format = core_config.format;
    let min_zoom = core_config.min_zoom.unwrap_or(0) as u8;
    let max_zoom = core_config.max_zoom.unwrap_or(8) as u8;
    let buffer = SharedBuffer::new();
    let mut writer = PmTilesTileWriter::with_format(buffer.cursor(), min_zoom, max_zoom, format)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Tiler::new(core_config)
        .process_bytes(image_bytes, &mut writer, progress_callback(on_progress))
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(buffer.take_bytes())
}

#[wasm_bindgen(js_name = processRgbTilesPmtiles)]
pub fn process_rgb_tiles_pmtiles(
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
    let min_zoom = core_config.min_zoom.unwrap_or(0) as u8;
    let max_zoom = core_config.max_zoom.unwrap_or(8) as u8;
    let buffer = SharedBuffer::new();
    let mut writer = PmTilesTileWriter::with_format(buffer.cursor(), min_zoom, max_zoom, format)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let image = DynamicImage::ImageRgb8(image);
    let report = progress_callback(on_progress);
    if use_streaming {
        StreamingTiler::new(core_config).process_image(&image, &mut writer, report)
    } else {
        Tiler::new(core_config).process_image(&image, &mut writer, report)
    }
    .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(buffer.take_bytes())
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
