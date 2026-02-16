use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, RgbaImage};
use std::io::{Seek, Write};
use thiserror::Error;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Error)]
pub enum TilerError {
    #[error("failed to decode image: {0}")]
    Decode(#[from] image::ImageError),
    #[error("image dimensions are zero")]
    ZeroDimensions,
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("png encoding error: {0}")]
    PngEncode(#[from] image::error::EncodingError),
    #[error("png decode error: {0}")]
    PngDecode(png::DecodingError),
}

/// Default memory threshold (256 MB) above which streaming is used.
pub const STREAMING_THRESHOLD: usize = 256 * 1024 * 1024;

/// Map projection type.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Projection {
    /// Flat / equirectangular — suitable for fictional maps and flat imagery.
    #[default]
    Flat,
    /// Web Mercator (EPSG:3857) — suitable for real-world geographic maps.
    Mercator,
}

#[derive(Debug, Clone)]
pub struct TileConfig {
    pub tile_size: u32,
    pub min_zoom: Option<u32>,
    pub max_zoom: Option<u32>,
    pub projection: Projection,
}

impl Default for TileConfig {
    fn default() -> Self {
        Self {
            tile_size: 256,
            min_zoom: None,
            max_zoom: None,
            projection: Projection::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TileProgress {
    pub zoom: u32,
    pub x: u32,
    pub y: u32,
    pub tiles_done: u32,
    pub tiles_total: u32,
}

#[derive(Debug)]
pub struct TileOutput {
    pub width: u32,
    pub height: u32,
    pub total_tiles: u32,
    pub zoom_levels: u32,
    pub min_zoom: u32,
    pub max_zoom: u32,
}

pub struct Tiler {
    config: TileConfig,
}

impl Tiler {
    pub fn new(config: TileConfig) -> Self {
        Self { config }
    }

    /// Calculate the maximum zoom level for the given image dimensions.
    pub fn calc_max_zoom(width: u32, height: u32, tile_size: u32) -> u32 {
        let max_dim = width.max(height) as f64;
        let ts = tile_size as f64;
        (max_dim / ts).log2().ceil().max(0.0) as u32
    }

    /// Calculate the total number of tiles across all zoom levels in the range.
    pub fn calc_total_tiles(min_zoom: u32, max_zoom: u32) -> u32 {
        (min_zoom..=max_zoom)
            .map(|z| {
                let grid = 1u32 << z;
                grid * grid
            })
            .sum()
    }

    /// Process an image from raw bytes, writing tiles into a zip archive.
    ///
    /// Auto-selects processing strategy:
    /// - Large PNG: streaming row-by-row decode (lowest memory)
    /// - Large non-PNG: full decode + strip-based tile extraction (no resized copies)
    /// - Small images: naive full decode + resize per zoom level (simplest/fastest)
    pub fn process_bytes<W, F>(
        &self,
        bytes: &[u8],
        writer: W,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        W: Write + Seek,
        F: Fn(TileProgress),
    {
        let is_png = crate::streaming::read_png_dimensions(bytes).is_some();
        let is_large = crate::streaming::should_use_streaming(bytes, STREAMING_THRESHOLD);

        if is_png && is_large {
            // PNG streaming: row-by-row decode, never holds full image
            let streaming = crate::streaming::StreamingTiler::new(self.config.clone());
            streaming.process_png(std::io::Cursor::new(bytes), writer, on_progress)
        } else if !is_png && is_large {
            // Non-PNG (JPEG etc): full decode but strip-based tile extraction
            // Avoids creating resized copies at each zoom level
            let img = image::load_from_memory(bytes)?;
            let streaming = crate::streaming::StreamingTiler::new(self.config.clone());
            streaming.process_image(&img, writer, on_progress)
        } else {
            let img = image::load_from_memory(bytes)?;
            self.process_image(&img, writer, on_progress)
        }
    }

    /// Process an image from raw bytes using the naive (full decode) strategy.
    pub fn process_bytes_naive<W, F>(
        &self,
        bytes: &[u8],
        writer: W,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        W: Write + Seek,
        F: Fn(TileProgress),
    {
        let img = image::load_from_memory(bytes)?;
        self.process_image(&img, writer, on_progress)
    }

    /// Process a DynamicImage, writing tiles into a zip archive.
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
        let (width, height) = img.dimensions();
        if width == 0 || height == 0 {
            return Err(TilerError::ZeroDimensions);
        }

        let tile_size = self.config.tile_size;
        let max_zoom = self
            .config
            .max_zoom
            .unwrap_or_else(|| Self::calc_max_zoom(width, height, tile_size));
        let min_zoom = self.config.min_zoom.unwrap_or(0);

        let total_tiles = Self::calc_total_tiles(min_zoom, max_zoom);
        let mut tiles_done = 0u32;

        let mut zip = ZipWriter::new(writer);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        for z in min_zoom..=max_zoom {
            let grid_size = 1u32 << z;
            let canvas_size = grid_size * tile_size;

            // Uniform scale: fit image within canvas preserving aspect ratio
            let max_dim = width.max(height) as u64;
            let scaled_w = ((width as u64 * canvas_size as u64) / max_dim).max(1) as u32;
            let scaled_h = ((height as u64 * canvas_size as u64) / max_dim).max(1) as u32;

            let canvas_img = if self.config.projection == Projection::Mercator {
                // Mercator: resize X uniformly, then remap Y per-row
                let resized = img.resize_exact(scaled_w, height, FilterType::Lanczos3);
                let src_rgba = resized.to_rgba8();
                let mut canvas_buf = RgbaImage::new(canvas_size, canvas_size);

                for cy in 0..canvas_size {
                    let t = cy as f64 / canvas_size as f64;
                    let src_y_f = crate::mercator::canvas_y_to_source_y(t) * (height as f64 - 1.0);

                    // Bilinear interpolation between two nearest source rows
                    let y0 = (src_y_f.floor() as u32).min(height - 1);
                    let y1 = (y0 + 1).min(height - 1);
                    let frac = src_y_f - y0 as f64;

                    for cx in 0..scaled_w.min(canvas_size) {
                        let p0 = src_rgba.get_pixel(cx, y0);
                        let p1 = src_rgba.get_pixel(cx, y1);
                        let r = (p0[0] as f64 * (1.0 - frac) + p1[0] as f64 * frac).round() as u8;
                        let g = (p0[1] as f64 * (1.0 - frac) + p1[1] as f64 * frac).round() as u8;
                        let b = (p0[2] as f64 * (1.0 - frac) + p1[2] as f64 * frac).round() as u8;
                        let a = (p0[3] as f64 * (1.0 - frac) + p1[3] as f64 * frac).round() as u8;
                        canvas_buf.put_pixel(cx, cy, image::Rgba([r, g, b, a]));
                    }
                }

                DynamicImage::ImageRgba8(canvas_buf)
            } else {
                // Flat: standard resize + overlay
                let resized = img.resize_exact(scaled_w, scaled_h, FilterType::Lanczos3);
                let mut canvas_buf = RgbaImage::new(canvas_size, canvas_size);
                image::imageops::overlay(&mut canvas_buf, &resized.to_rgba8(), 0, 0);
                DynamicImage::ImageRgba8(canvas_buf)
            };

            for x in 0..grid_size {
                for y in 0..grid_size {
                    let tile = canvas_img.crop_imm(
                        x * tile_size,
                        y * tile_size,
                        tile_size,
                        tile_size,
                    );

                    let path = format!("{z}/{x}/{y}.png");
                    zip.start_file(&path, options)?;

                    let rgba: RgbaImage = tile.to_rgba8();
                    let mut png_buf = Vec::new();
                    let encoder = image::codecs::png::PngEncoder::new(&mut png_buf);
                    image::ImageEncoder::write_image(
                        encoder,
                        rgba.as_raw(),
                        tile_size,
                        tile_size,
                        image::ExtendedColorType::Rgba8,
                    )?;
                    zip.write_all(&png_buf)?;

                    tiles_done += 1;
                    on_progress(TileProgress {
                        zoom: z,
                        x,
                        y,
                        tiles_done,
                        tiles_total: total_tiles,
                    });
                }
            }
        }

        zip.finish()?;

        Ok(TileOutput {
            width,
            height,
            total_tiles,
            zoom_levels: max_zoom - min_zoom + 1,
            min_zoom,
            max_zoom,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_zoom_256() {
        // 256x256 image with 256 tile size → max zoom 0 (1 tile)
        assert_eq!(Tiler::calc_max_zoom(256, 256, 256), 0);
    }

    #[test]
    fn test_max_zoom_512() {
        // 512x512 → log2(2) = 1
        assert_eq!(Tiler::calc_max_zoom(512, 512, 256), 1);
    }

    #[test]
    fn test_max_zoom_1000() {
        // 1000/256 = 3.906 → log2(3.906) = 1.966 → ceil = 2
        assert_eq!(Tiler::calc_max_zoom(1000, 1000, 256), 2);
    }

    #[test]
    fn test_max_zoom_rectangular() {
        // 2000x500 → max(2000,500)/256 = 7.8125 → log2 = 2.965 → ceil = 3
        assert_eq!(Tiler::calc_max_zoom(2000, 500, 256), 3);
    }

    #[test]
    fn test_max_zoom_10k() {
        // 10000/256 = 39.06 → log2 = 5.29 → ceil = 6
        assert_eq!(Tiler::calc_max_zoom(10000, 10000, 256), 6);
    }

    #[test]
    fn test_total_tiles() {
        // z0: 1, z1: 4, z2: 16 = 21
        assert_eq!(Tiler::calc_total_tiles(0, 2), 21);
    }

    #[test]
    fn test_total_tiles_single_zoom() {
        assert_eq!(Tiler::calc_total_tiles(0, 0), 1);
        assert_eq!(Tiler::calc_total_tiles(3, 3), 64);
    }

    #[test]
    fn test_process_small_image() {
        // Create a 512x512 red test image
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            512,
            512,
            image::Rgba([255, 0, 0, 255]),
        ));

        let tiler = Tiler::new(TileConfig::default());
        let mut buf = std::io::Cursor::new(Vec::new());

        let output = tiler
            .process_image(&img, &mut buf, |_| {})
            .expect("processing should succeed");

        assert_eq!(output.max_zoom, 1);
        // z0: 1 tile, z1: 4 tiles = 5
        assert_eq!(output.total_tiles, 5);

        // Verify zip contents
        let data = buf.into_inner();
        let reader = std::io::Cursor::new(data);
        let mut archive = zip::ZipArchive::new(reader).unwrap();

        let expected_files = ["0/0/0.png", "1/0/0.png", "1/0/1.png", "1/1/0.png", "1/1/1.png"];
        assert_eq!(archive.len(), expected_files.len());

        for name in &expected_files {
            assert!(
                archive.by_name(name).is_ok(),
                "missing expected file: {name}"
            );
        }
    }

    #[test]
    fn test_process_rectangular_image_no_distortion() {
        // Create a 1024x512 image (2:1 aspect ratio)
        // Red left half, blue right half — if distorted, tile colors would be wrong
        let mut img = RgbaImage::new(1024, 512);
        for (x, _y, pixel) in img.enumerate_pixels_mut() {
            if x < 512 {
                *pixel = image::Rgba([255, 0, 0, 255]); // red
            } else {
                *pixel = image::Rgba([0, 0, 255, 255]); // blue
            }
        }
        let dyn_img = DynamicImage::ImageRgba8(img);

        let tiler = Tiler::new(TileConfig {
            tile_size: 256,
            max_zoom: Some(2),
            ..Default::default()
        });
        let mut buf = std::io::Cursor::new(Vec::new());
        let output = tiler
            .process_image(&dyn_img, &mut buf, |_| {})
            .expect("processing should succeed");

        assert_eq!(output.width, 1024);
        assert_eq!(output.height, 512);

        // Verify zip contents — at zoom 2, grid is 4×4.
        // Image occupies the full width (4 columns) but only ~half the height (2 rows).
        // Tiles in rows 2-3 should be fully transparent.
        let data = buf.into_inner();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&data)).unwrap();

        // Check a tile that should be transparent (bottom-right at zoom 2)
        let transparent_tile_data = {
            let mut file = archive.by_name("2/3/3.png").expect("tile 2/3/3 should exist");
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut bytes).unwrap();
            bytes
        };
        let transparent_tile = image::load_from_memory(&transparent_tile_data).unwrap().to_rgba8();
        // All pixels should be transparent (alpha = 0)
        assert!(
            transparent_tile.pixels().all(|p| p.0[3] == 0),
            "tile 2/3/3 should be fully transparent for rectangular image"
        );

        // Check a tile that should have content (top-left at zoom 2)
        let content_tile_data = {
            let mut file = archive.by_name("2/0/0.png").expect("tile 2/0/0 should exist");
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut bytes).unwrap();
            bytes
        };
        let content_tile = image::load_from_memory(&content_tile_data).unwrap().to_rgba8();
        // Should be mostly red (left portion of image), definitely not transparent
        let center = content_tile.get_pixel(128, 128);
        assert_eq!(center.0[3], 255, "content tile should be opaque");
        assert!(center.0[0] > 200, "content tile should be red-ish (got r={})", center.0[0]);
    }
}
