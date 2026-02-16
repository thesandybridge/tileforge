use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, RgbaImage};
use std::io::{BufRead, Seek, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::{TileConfig, TileOutput, TileProgress, Tiler, TilerError};

/// Streaming tiler that processes PNG images row-by-row.
///
/// Instead of decoding the entire image into memory, this reads source rows
/// in strips, generates max-zoom tiles from each strip, then builds lower
/// zoom levels by merging 4 tiles → 1 (pyramid). Each tile is written to
/// the zip immediately and released.
pub struct StreamingTiler {
    config: TileConfig,
}

/// Tracks the pyramid merge state across all zoom levels.
struct PyramidState {
    /// For each zoom level, an optional pending tile row waiting for its pair.
    pending: Vec<Option<Vec<RgbaImage>>>,
    /// For each zoom level, how many complete rows have been emitted.
    row_counters: Vec<u32>,
    min_zoom: u32,
    tile_size: u32,
}

impl PyramidState {
    fn new(max_zoom: u32, min_zoom: u32, tile_size: u32) -> Self {
        let levels = (max_zoom + 1) as usize;
        Self {
            pending: vec![None; levels],
            row_counters: vec![0; levels],
            min_zoom,
            tile_size,
        }
    }

    /// Push a completed tile row at `zoom` into the pyramid.
    /// Writes merged tiles to zip and cascades downward.
    fn push_row<W, F>(
        &mut self,
        zoom: u32,
        row_tiles: Vec<RgbaImage>,
        zip: &mut ZipWriter<W>,
        zip_opts: &SimpleFileOptions,
        tiles_done: &mut u32,
        tiles_total: u32,
        on_progress: &F,
    ) -> Result<(), TilerError>
    where
        W: Write + Seek,
        F: Fn(TileProgress),
    {
        let z = zoom as usize;

        if let Some(prev_row) = self.pending[z].take() {
            // Merge two rows into one at zoom-1
            let merged = merge_tile_rows(&prev_row, &row_tiles, self.tile_size);
            let parent_zoom = zoom - 1;
            let parent_tile_row = self.row_counters[parent_zoom as usize];
            self.row_counters[parent_zoom as usize] += 1;

            // Write merged tiles to zip
            for (tx, tile) in merged.iter().enumerate() {
                write_tile_png(
                    zip,
                    zip_opts,
                    parent_zoom,
                    tx as u32,
                    parent_tile_row,
                    tile,
                    self.tile_size,
                )?;
                *tiles_done += 1;
                on_progress(TileProgress {
                    zoom: parent_zoom,
                    x: tx as u32,
                    y: parent_tile_row,
                    tiles_done: *tiles_done,
                    tiles_total,
                });
            }

            // Cascade further if not at min_zoom
            if parent_zoom > self.min_zoom {
                self.push_row(
                    parent_zoom,
                    merged,
                    zip,
                    zip_opts,
                    tiles_done,
                    tiles_total,
                    on_progress,
                )?;
            }
        } else {
            self.pending[z] = Some(row_tiles);
        }

        Ok(())
    }
}

impl StreamingTiler {
    pub fn new(config: TileConfig) -> Self {
        Self { config }
    }

    pub fn process_png<R, W, F>(
        &self,
        reader: R,
        writer: W,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        R: BufRead + Seek,
        W: Write + Seek,
        F: Fn(TileProgress),
    {
        let tile_size = self.config.tile_size;

        // 1. Read PNG header
        let decoder = png::Decoder::new(reader);
        let mut png_reader = decoder.read_info().map_err(TilerError::PngDecode)?;
        let info = png_reader.info().clone();
        let src_w = info.width;
        let src_h = info.height;

        if src_w == 0 || src_h == 0 {
            return Err(TilerError::ZeroDimensions);
        }

        // 2. Calculate zoom levels
        let max_zoom = self
            .config
            .max_zoom
            .unwrap_or_else(|| Tiler::calc_max_zoom(src_w, src_h, tile_size));
        let min_zoom = self.config.min_zoom.unwrap_or(0);
        let grid = 1u32 << max_zoom;
        let canvas = (grid as u64) * (tile_size as u64);

        let total_tiles = Tiler::calc_total_tiles(min_zoom, max_zoom);
        let mut tiles_done = 0u32;

        // 3. Setup zip writer
        let mut zip = ZipWriter::new(writer);
        let zip_opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        // 4. Pyramid state for cascading merges
        let mut pyramid = PyramidState::new(max_zoom, min_zoom, tile_size);

        // 5. Source row decode state
        let color_type = info.color_type;
        let mut strip_rows: Vec<Vec<u8>> = Vec::new();
        let mut decoded_row_count: u32 = 0;
        let mut strip_start_row: u32 = 0;
        let max_dim = src_w.max(src_h) as f64;

        // 6. Process each tile row at max zoom
        for tile_row in 0..grid {
            // Source Y range needed (uniform scale, with 1px margin for interpolation)
            let src_y_start_f =
                tile_row as f64 * tile_size as f64 * max_dim / canvas as f64;
            let src_y_end_f =
                (tile_row + 1) as f64 * tile_size as f64 * max_dim / canvas as f64;

            // If this tile row is entirely beyond the image, emit transparent tiles
            if src_y_start_f >= src_h as f64 {
                let mut row_tiles = Vec::with_capacity(grid as usize);
                for tile_col in 0..grid {
                    let tile = RgbaImage::new(tile_size, tile_size);
                    write_tile_png(
                        &mut zip, &zip_opts, max_zoom, tile_col, tile_row,
                        &tile, tile_size,
                    )?;
                    tiles_done += 1;
                    on_progress(TileProgress {
                        zoom: max_zoom, x: tile_col, y: tile_row,
                        tiles_done, tiles_total: total_tiles,
                    });
                    row_tiles.push(tile);
                }
                if max_zoom > min_zoom {
                    pyramid.push_row(
                        max_zoom, row_tiles, &mut zip, &zip_opts,
                        &mut tiles_done, total_tiles, &on_progress,
                    )?;
                }
                continue;
            }

            let src_y_start = (src_y_start_f.floor() as u32)
                .saturating_sub(1)
                .min(src_h.saturating_sub(1));
            let src_y_end = ((src_y_end_f.ceil() as u32) + 1).min(src_h);

            // Trim rows we no longer need
            if src_y_start > strip_start_row {
                let drop_count =
                    ((src_y_start - strip_start_row) as usize).min(strip_rows.len());
                strip_rows.drain(..drop_count);
                strip_start_row += drop_count as u32;
            }

            // Read more source rows as needed
            while decoded_row_count < src_y_end {
                match png_reader.next_row().map_err(TilerError::PngDecode)? {
                    Some(row) => {
                        if decoded_row_count >= strip_start_row {
                            let rgba = convert_row_to_rgba(row.data(), color_type, src_w);
                            strip_rows.push(rgba);
                        }
                        decoded_row_count += 1;
                    }
                    None => break,
                }
            }

            // Build strip as RgbaImage
            let strip_h = strip_rows.len() as u32;
            let mut strip_data =
                Vec::with_capacity((src_w as usize) * (strip_h as usize) * 4);
            for row_data in &strip_rows {
                strip_data.extend_from_slice(row_data);
            }
            let strip = RgbaImage::from_raw(src_w, strip_h, strip_data)
                .ok_or(TilerError::ZeroDimensions)?;

            // Generate max-zoom tiles for this row
            let mut row_tiles = Vec::with_capacity(grid as usize);

            for tile_col in 0..grid {
                let tile = extract_tile(
                    &strip,
                    strip_start_row,
                    tile_col,
                    tile_row,
                    tile_size,
                    src_w,
                    src_h,
                    canvas,
                );

                write_tile_png(
                    &mut zip,
                    &zip_opts,
                    max_zoom,
                    tile_col,
                    tile_row,
                    &tile,
                    tile_size,
                )?;

                tiles_done += 1;
                on_progress(TileProgress {
                    zoom: max_zoom,
                    x: tile_col,
                    y: tile_row,
                    tiles_done,
                    tiles_total: total_tiles,
                });

                row_tiles.push(tile);
            }

            // Feed row into pyramid (cascades merges to lower zoom levels)
            if max_zoom > min_zoom {
                pyramid.push_row(
                    max_zoom,
                    row_tiles,
                    &mut zip,
                    &zip_opts,
                    &mut tiles_done,
                    total_tiles,
                    &on_progress,
                )?;
            }
        }

        zip.finish()?;

        Ok(TileOutput {
            width: src_w,
            height: src_h,
            total_tiles,
            zoom_levels: max_zoom - min_zoom + 1,
            min_zoom,
            max_zoom,
        })
    }

    /// Process a pre-decoded image using strip-based tile extraction + pyramid.
    ///
    /// Unlike the naive approach, this never creates full-size resized copies
    /// of the source. Each tile is cropped and resampled individually from the
    /// source, then lower zoom levels are built by merging tiles (4→1).
    ///
    /// Use this for JPEG and other formats where row-by-row decode isn't
    /// available but you still want to avoid the resize-per-zoom-level memory spike.
    pub fn process_image<W, F>(
        &self,
        img: &DynamicImage,
        writer: W,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        W: Write + Seek,
        F: Fn(TileProgress),
    {
        let tile_size = self.config.tile_size;
        let (src_w, src_h) = img.dimensions();

        if src_w == 0 || src_h == 0 {
            return Err(TilerError::ZeroDimensions);
        }

        let max_zoom = self
            .config
            .max_zoom
            .unwrap_or_else(|| Tiler::calc_max_zoom(src_w, src_h, tile_size));
        let min_zoom = self.config.min_zoom.unwrap_or(0);
        let grid = 1u32 << max_zoom;
        let canvas = (grid as u64) * (tile_size as u64);

        let total_tiles = Tiler::calc_total_tiles(min_zoom, max_zoom);
        let mut tiles_done = 0u32;

        let mut zip = ZipWriter::new(writer);
        let zip_opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        let mut pyramid = PyramidState::new(max_zoom, min_zoom, tile_size);

        // Convert to RGBA once — no per-zoom-level resize
        let source = img.to_rgba8();

        for tile_row in 0..grid {
            let mut row_tiles = Vec::with_capacity(grid as usize);

            for tile_col in 0..grid {
                let tile = extract_tile(
                    &source,
                    0, // strip_start_row = 0, source is the full image
                    tile_col,
                    tile_row,
                    tile_size,
                    src_w,
                    src_h,
                    canvas,
                );

                write_tile_png(
                    &mut zip,
                    &zip_opts,
                    max_zoom,
                    tile_col,
                    tile_row,
                    &tile,
                    tile_size,
                )?;

                tiles_done += 1;
                on_progress(TileProgress {
                    zoom: max_zoom,
                    x: tile_col,
                    y: tile_row,
                    tiles_done,
                    tiles_total: total_tiles,
                });

                row_tiles.push(tile);
            }

            if max_zoom > min_zoom {
                pyramid.push_row(
                    max_zoom,
                    row_tiles,
                    &mut zip,
                    &zip_opts,
                    &mut tiles_done,
                    total_tiles,
                    &on_progress,
                )?;
            }
        }

        zip.finish()?;

        Ok(TileOutput {
            width: src_w,
            height: src_h,
            total_tiles,
            zoom_levels: max_zoom - min_zoom + 1,
            min_zoom,
            max_zoom,
        })
    }
}

/// Extract a single tile from the source strip by cropping and resampling.
///
/// Uses uniform scaling based on max(src_w, src_h) so non-square images
/// maintain their aspect ratio. Tiles outside the image bounds are transparent.
fn extract_tile(
    strip: &RgbaImage,
    strip_start_row: u32,
    tile_col: u32,
    tile_row: u32,
    tile_size: u32,
    src_w: u32,
    src_h: u32,
    canvas: u64,
) -> RgbaImage {
    let max_dim = src_w.max(src_h) as f64;

    // Map tile canvas position back to source using uniform scale
    let src_x_start_f = tile_col as f64 * tile_size as f64 * max_dim / canvas as f64;
    let src_x_end_f =
        (tile_col + 1) as f64 * tile_size as f64 * max_dim / canvas as f64;
    let src_y_start_f = tile_row as f64 * tile_size as f64 * max_dim / canvas as f64;
    let src_y_end_f =
        (tile_row + 1) as f64 * tile_size as f64 * max_dim / canvas as f64;

    // Tile is fully outside the image — return transparent
    if src_x_start_f >= src_w as f64 || src_y_start_f >= src_h as f64 {
        return RgbaImage::new(tile_size, tile_size);
    }

    let crop_x = (src_x_start_f.floor() as u32).min(src_w.saturating_sub(1));
    let crop_x_end = ((src_x_end_f.ceil() as u32) + 1).min(src_w);
    let crop_y_global = (src_y_start_f.floor() as u32).min(src_h.saturating_sub(1));
    let crop_y_end_global = ((src_y_end_f.ceil() as u32) + 1).min(src_h);

    let local_y = crop_y_global.saturating_sub(strip_start_row);
    let local_y_end = crop_y_end_global
        .saturating_sub(strip_start_row)
        .min(strip.height());

    let crop_w = (crop_x_end - crop_x).max(1);
    let crop_h = (local_y_end - local_y).max(1);

    let crop = image::imageops::crop_imm(strip, crop_x, local_y, crop_w, crop_h);

    // Calculate what fraction of the tile is covered by image data
    let tile_src_range = tile_size as f64 * max_dim / canvas as f64;
    let avail_x = (src_w as f64 - src_x_start_f).min(tile_src_range).max(0.0);
    let avail_y = (src_h as f64 - src_y_start_f).min(tile_src_range).max(0.0);
    let frac_x = avail_x / tile_src_range;
    let frac_y = avail_y / tile_src_range;

    let dest_w = (frac_x * tile_size as f64).round().max(1.0) as u32;
    let dest_h = (frac_y * tile_size as f64).round().max(1.0) as u32;

    let resized =
        image::imageops::resize(&*crop, dest_w, dest_h, FilterType::Lanczos3);

    if dest_w >= tile_size && dest_h >= tile_size {
        resized
    } else {
        // Partial tile: place resized content on transparent background
        let mut tile = RgbaImage::new(tile_size, tile_size);
        image::imageops::overlay(&mut tile, &resized, 0, 0);
        tile
    }
}

/// Write a tile as PNG into the zip archive.
fn write_tile_png<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    opts: &SimpleFileOptions,
    zoom: u32,
    x: u32,
    y: u32,
    tile: &RgbaImage,
    tile_size: u32,
) -> Result<(), TilerError> {
    let path = format!("{zoom}/{x}/{y}.png");
    zip.start_file(&path, *opts)?;

    let mut png_buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_buf);
    image::ImageEncoder::write_image(
        encoder,
        tile.as_raw(),
        tile_size,
        tile_size,
        image::ExtendedColorType::Rgba8,
    )?;
    zip.write_all(&png_buf)?;
    Ok(())
}

/// Merge two tile rows into one row at the parent zoom level.
/// top = even y row, bottom = odd y row.
/// Each group of 4 tiles (2x2) is composited and downscaled to one tile.
fn merge_tile_rows(top: &[RgbaImage], bottom: &[RgbaImage], tile_size: u32) -> Vec<RgbaImage> {
    let out_count = top.len() / 2;
    let mut result = Vec::with_capacity(out_count);
    let ts = tile_size;
    let double = ts * 2;

    for i in 0..out_count {
        let tl = &top[i * 2];
        let tr = &top[i * 2 + 1];
        let bl = &bottom[i * 2];
        let br = &bottom[i * 2 + 1];

        let mut canvas = RgbaImage::new(double, double);
        image::imageops::overlay(&mut canvas, tl, 0, 0);
        image::imageops::overlay(&mut canvas, tr, ts as i64, 0);
        image::imageops::overlay(&mut canvas, bl, 0, ts as i64);
        image::imageops::overlay(&mut canvas, br, ts as i64, ts as i64);

        let merged = image::imageops::resize(&canvas, ts, ts, FilterType::Lanczos3);
        result.push(merged);
    }

    result
}

/// Convert a raw PNG row to RGBA8 format.
fn convert_row_to_rgba(data: &[u8], color_type: png::ColorType, width: u32) -> Vec<u8> {
    let w = width as usize;
    match color_type {
        png::ColorType::Rgba => data[..w * 4].to_vec(),
        png::ColorType::Rgb => {
            let mut rgba = Vec::with_capacity(w * 4);
            for i in 0..w {
                rgba.extend_from_slice(&data[i * 3..i * 3 + 3]);
                rgba.push(255);
            }
            rgba
        }
        png::ColorType::GrayscaleAlpha => {
            let mut rgba = Vec::with_capacity(w * 4);
            for i in 0..w {
                let g = data[i * 2];
                let a = data[i * 2 + 1];
                rgba.extend_from_slice(&[g, g, g, a]);
            }
            rgba
        }
        png::ColorType::Grayscale => {
            let mut rgba = Vec::with_capacity(w * 4);
            for i in 0..w {
                let g = data[i];
                rgba.extend_from_slice(&[g, g, g, 255]);
            }
            rgba
        }
        png::ColorType::Indexed => {
            // Shouldn't occur after EXPAND, but handle as RGB fallback
            let mut rgba = Vec::with_capacity(w * 4);
            for i in 0..w {
                rgba.extend_from_slice(&data[i * 3..i * 3 + 3]);
                rgba.push(255);
            }
            rgba
        }
    }
}

/// Read PNG dimensions from raw header bytes without decoding the image.
pub fn read_png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 {
        return None;
    }
    if &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

/// Returns true if the image's decoded RGBA memory would exceed the budget.
///
/// Checks PNG header first (fast), falls back to the `image` crate's
/// dimension reader for JPEG and other formats.
pub fn should_use_streaming(bytes: &[u8], memory_budget: usize) -> bool {
    let dims = if let Some(dims) = read_png_dimensions(bytes) {
        Some(dims)
    } else {
        image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_dimensions().ok())
    };

    if let Some((w, h)) = dims {
        (w as usize) * (h as usize) * 4 > memory_budget
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_png_dimensions() {
        // Create a small PNG in memory
        let img = RgbaImage::from_pixel(320, 240, image::Rgba([0, 0, 0, 255]));
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            320,
            240,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();

        let dims = read_png_dimensions(&buf);
        assert_eq!(dims, Some((320, 240)));
    }

    #[test]
    fn test_read_png_dimensions_not_png() {
        assert_eq!(read_png_dimensions(b"not a png"), None);
        assert_eq!(read_png_dimensions(b"short"), None);
    }

    #[test]
    fn test_should_use_streaming() {
        // 1000x1000 RGBA = 4MB, budget 1MB → should stream
        let img = RgbaImage::from_pixel(1000, 1000, image::Rgba([0, 0, 0, 255]));
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            1000,
            1000,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();

        assert!(should_use_streaming(&buf, 1_000_000));
        assert!(!should_use_streaming(&buf, 100_000_000));
    }

    #[test]
    fn test_merge_tile_rows() {
        let ts = 4u32; // small tiles for test
        let red = RgbaImage::from_pixel(ts, ts, image::Rgba([255, 0, 0, 255]));
        let green = RgbaImage::from_pixel(ts, ts, image::Rgba([0, 255, 0, 255]));
        let blue = RgbaImage::from_pixel(ts, ts, image::Rgba([0, 0, 255, 255]));
        let white = RgbaImage::from_pixel(ts, ts, image::Rgba([255, 255, 255, 255]));

        let top = vec![red, green];
        let bottom = vec![blue, white];
        let merged = merge_tile_rows(&top, &bottom, ts);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].width(), ts);
        assert_eq!(merged[0].height(), ts);
    }

    #[test]
    fn test_streaming_small_png() {
        // Create a 512x512 PNG
        let img = RgbaImage::from_pixel(512, 512, image::Rgba([255, 0, 0, 255]));
        let mut png_bytes = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            512,
            512,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();

        let tiler = StreamingTiler::new(TileConfig::default());
        let reader = std::io::Cursor::new(&png_bytes);
        let mut zip_buf = std::io::Cursor::new(Vec::new());

        let output = tiler
            .process_png(reader, &mut zip_buf, |_| {})
            .expect("streaming should succeed");

        assert_eq!(output.max_zoom, 1);
        assert_eq!(output.total_tiles, 5);

        // Verify zip contents
        let data = zip_buf.into_inner();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).unwrap();

        let expected = ["0/0/0.png", "1/0/0.png", "1/0/1.png", "1/1/0.png", "1/1/1.png"];
        assert_eq!(archive.len(), expected.len());
        for name in &expected {
            assert!(
                archive.by_name(name).is_ok(),
                "missing expected file: {name}"
            );
        }
    }
}
