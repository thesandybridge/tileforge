use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, RgbaImage};
use thiserror::Error;

#[cfg(feature = "parallel")]
use rayon::prelude::*;

use crate::writer::TileWriter;

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
    #[error("write error: {0}")]
    Write(String),
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

/// Scale metadata for accurate measurements on the output tileset.
#[derive(Debug, Clone, Default)]
pub struct ScaleMetadata {
    /// How scale is defined: "pixels_per_unit" or "units_per_tile"
    pub mode: Option<String>,
    /// The numeric scale value (e.g., 10 for "10 pixels = 1 unit")
    pub value: Option<f64>,
    /// The unit name (e.g., "meters", "feet", "km")
    pub unit: Option<String>,
    /// Geographic bounds [west, south, east, north] for Mercator maps
    pub bounds: Option<[f64; 4]>,
}

/// RGBA background color (0-255 per channel).
#[derive(Debug, Clone, Copy)]
pub struct BackgroundColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Default for BackgroundColor {
    fn default() -> Self {
        Self { r: 0, g: 0, b: 0, a: 0 } // Transparent
    }
}

impl BackgroundColor {
    pub fn transparent() -> Self {
        Self::default()
    }

    pub fn from_rgba(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    pub fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim_start_matches('#');
        if hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some(Self { r, g, b, a: 255 })
        } else if hex.len() == 8 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
            Some(Self { r, g, b, a })
        } else {
            None
        }
    }

    pub fn is_transparent(&self) -> bool {
        self.a == 0
    }

    pub fn to_rgba(&self) -> [u8; 4] {
        [self.r, self.g, self.b, self.a]
    }
}

#[derive(Debug, Clone)]
pub struct TileConfig {
    pub tile_size: u32,
    pub min_zoom: Option<u32>,
    pub max_zoom: Option<u32>,
    pub projection: Projection,
    /// Pre-scale factor applied to the image before tiling (e.g., 0.5 = half size, 2.0 = double)
    pub scale: Option<f64>,
    /// Background color to fill transparent areas
    pub background: Option<BackgroundColor>,
    /// Scale metadata for measurements
    pub scale_metadata: Option<ScaleMetadata>,
}

impl Default for TileConfig {
    fn default() -> Self {
        Self {
            tile_size: 256,
            min_zoom: None,
            max_zoom: None,
            projection: Projection::default(),
            scale: None,
            background: None,
            scale_metadata: None,
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
    pub fn process_bytes<TW, F>(
        &self,
        bytes: &[u8],
        tile_writer: &mut TW,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        TW: TileWriter,
        F: Fn(TileProgress),
    {
        let is_png = crate::streaming::read_png_dimensions(bytes).is_some();
        let is_large = crate::streaming::should_use_streaming(bytes, STREAMING_THRESHOLD);

        if is_png && is_large {
            // PNG streaming: row-by-row decode, never holds full image
            let streaming = crate::streaming::StreamingTiler::new(self.config.clone());
            streaming.process_png(std::io::Cursor::new(bytes), tile_writer, on_progress)
        } else if !is_png && is_large {
            // Non-PNG (JPEG etc): full decode but strip-based tile extraction
            // Avoids creating resized copies at each zoom level
            let img = image::load_from_memory(bytes)?;
            let streaming = crate::streaming::StreamingTiler::new(self.config.clone());
            streaming.process_image(&img, tile_writer, on_progress)
        } else {
            let img = image::load_from_memory(bytes)?;
            self.process_image(&img, tile_writer, on_progress)
        }
    }

    /// Process an image from raw bytes using the naive (full decode) strategy.
    pub fn process_bytes_naive<TW, F>(
        &self,
        bytes: &[u8],
        tile_writer: &mut TW,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        TW: TileWriter,
        F: Fn(TileProgress),
    {
        let img = image::load_from_memory(bytes)?;
        self.process_image(&img, tile_writer, on_progress)
    }

    /// Process a DynamicImage, writing tiles via the given TileWriter.
    pub fn process_image<TW, F>(
        &self,
        img: &DynamicImage,
        tile_writer: &mut TW,
        on_progress: F,
    ) -> Result<TileOutput, TilerError>
    where
        TW: TileWriter,
        F: Fn(TileProgress),
    {
        // Apply pre-scaling if configured
        let img = if let Some(scale) = self.config.scale {
            if (scale - 1.0).abs() > 0.001 {
                let (w, h) = img.dimensions();
                let new_w = ((w as f64 * scale) as u32).max(1);
                let new_h = ((h as f64 * scale) as u32).max(1);
                std::borrow::Cow::Owned(img.resize_exact(new_w, new_h, FilterType::CatmullRom))
            } else {
                std::borrow::Cow::Borrowed(img)
            }
        } else {
            std::borrow::Cow::Borrowed(img)
        };

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

        // Get background color (default to transparent)
        let bg = self.config.background.unwrap_or_else(BackgroundColor::transparent);
        let bg_pixel = image::Rgba(bg.to_rgba());

        for z in min_zoom..=max_zoom {
            let grid_size = 1u32 << z;
            let canvas_size = grid_size * tile_size;

            // Uniform scale: fit image within canvas preserving aspect ratio
            let max_dim = width.max(height) as u64;
            let scaled_w = ((width as u64 * canvas_size as u64) / max_dim).max(1) as u32;
            let scaled_h = ((height as u64 * canvas_size as u64) / max_dim).max(1) as u32;

            let canvas_img = if self.config.projection == Projection::Mercator {
                // Mercator: resize X uniformly, then remap Y per-row
                let resized = img.resize_exact(scaled_w, height, FilterType::CatmullRom);
                let src_rgba = resized.to_rgba8();
                let mut canvas_buf = RgbaImage::from_pixel(canvas_size, canvas_size, bg_pixel);

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
                        // Blend with background if pixel is semi-transparent
                        let pixel = if a < 255 && !bg.is_transparent() {
                            let alpha = a as f64 / 255.0;
                            let inv_alpha = 1.0 - alpha;
                            image::Rgba([
                                (r as f64 * alpha + bg.r as f64 * inv_alpha).round() as u8,
                                (g as f64 * alpha + bg.g as f64 * inv_alpha).round() as u8,
                                (b as f64 * alpha + bg.b as f64 * inv_alpha).round() as u8,
                                255,
                            ])
                        } else {
                            image::Rgba([r, g, b, a])
                        };
                        canvas_buf.put_pixel(cx, cy, pixel);
                    }
                }

                DynamicImage::ImageRgba8(canvas_buf)
            } else {
                // Flat: standard resize + overlay
                let resized = img.resize_exact(scaled_w, scaled_h, FilterType::CatmullRom);
                let mut canvas_buf = RgbaImage::from_pixel(canvas_size, canvas_size, bg_pixel);
                // Blend resized image onto background
                if bg.is_transparent() {
                    image::imageops::overlay(&mut canvas_buf, &resized.to_rgba8(), 0, 0);
                } else {
                    // Manual blend for non-transparent background
                    let resized_rgba = resized.to_rgba8();
                    for (x, y, pixel) in resized_rgba.enumerate_pixels() {
                        if pixel[3] == 255 {
                            canvas_buf.put_pixel(x, y, *pixel);
                        } else if pixel[3] > 0 {
                            let alpha = pixel[3] as f64 / 255.0;
                            let inv_alpha = 1.0 - alpha;
                            let blended = image::Rgba([
                                (pixel[0] as f64 * alpha + bg.r as f64 * inv_alpha).round() as u8,
                                (pixel[1] as f64 * alpha + bg.g as f64 * inv_alpha).round() as u8,
                                (pixel[2] as f64 * alpha + bg.b as f64 * inv_alpha).round() as u8,
                                255,
                            ]);
                            canvas_buf.put_pixel(x, y, blended);
                        }
                        // If alpha == 0, keep the background pixel
                    }
                }
                DynamicImage::ImageRgba8(canvas_buf)
            };

            // Process tiles row by row, parallelizing within each row
            for y in 0..grid_size {
                // Extract and encode tiles in parallel
                #[cfg(feature = "parallel")]
                let row_tiles: Vec<Vec<u8>> = (0..grid_size)
                    .into_par_iter()
                    .map(|x| {
                        let tile = canvas_img.crop_imm(
                            x * tile_size,
                            y * tile_size,
                            tile_size,
                            tile_size,
                        );
                        let rgba: RgbaImage = tile.to_rgba8();
                        let mut png_buf = Vec::new();
                        let encoder = image::codecs::png::PngEncoder::new_with_quality(
                            &mut png_buf,
                            image::codecs::png::CompressionType::Fast,
                            image::codecs::png::FilterType::Adaptive,
                        );
                        let _ = image::ImageEncoder::write_image(
                            encoder,
                            rgba.as_raw(),
                            tile_size,
                            tile_size,
                            image::ExtendedColorType::Rgba8,
                        );
                        png_buf
                    })
                    .collect();

                #[cfg(not(feature = "parallel"))]
                let row_tiles: Vec<Vec<u8>> = (0..grid_size)
                    .map(|x| {
                        let tile = canvas_img.crop_imm(
                            x * tile_size,
                            y * tile_size,
                            tile_size,
                            tile_size,
                        );
                        let rgba: RgbaImage = tile.to_rgba8();
                        let mut png_buf = Vec::new();
                        let encoder = image::codecs::png::PngEncoder::new_with_quality(
                            &mut png_buf,
                            image::codecs::png::CompressionType::Fast,
                            image::codecs::png::FilterType::Adaptive,
                        );
                        let _ = image::ImageEncoder::write_image(
                            encoder,
                            rgba.as_raw(),
                            tile_size,
                            tile_size,
                            image::ExtendedColorType::Rgba8,
                        );
                        png_buf
                    })
                    .collect();

                // Write tiles sequentially
                for (x, png_buf) in row_tiles.into_iter().enumerate() {
                    tile_writer.write_tile(z, x as u32, y, &png_buf)?;

                    tiles_done += 1;
                    on_progress(TileProgress {
                        zoom: z,
                        x: x as u32,
                        y,
                        tiles_done,
                        tiles_total: total_tiles,
                    });
                }
            }
        }

        tile_writer.finish()?;

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
    use crate::writer::ZipTileWriter;

    #[test]
    fn test_max_zoom_256() {
        assert_eq!(Tiler::calc_max_zoom(256, 256, 256), 0);
    }

    #[test]
    fn test_max_zoom_512() {
        assert_eq!(Tiler::calc_max_zoom(512, 512, 256), 1);
    }

    #[test]
    fn test_max_zoom_1000() {
        assert_eq!(Tiler::calc_max_zoom(1000, 1000, 256), 2);
    }

    #[test]
    fn test_max_zoom_rectangular() {
        assert_eq!(Tiler::calc_max_zoom(2000, 500, 256), 3);
    }

    #[test]
    fn test_max_zoom_10k() {
        assert_eq!(Tiler::calc_max_zoom(10000, 10000, 256), 6);
    }

    #[test]
    fn test_total_tiles() {
        assert_eq!(Tiler::calc_total_tiles(0, 2), 21);
    }

    #[test]
    fn test_total_tiles_single_zoom() {
        assert_eq!(Tiler::calc_total_tiles(0, 0), 1);
        assert_eq!(Tiler::calc_total_tiles(3, 3), 64);
    }

    #[test]
    fn test_process_small_image() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            512, 512, image::Rgba([255, 0, 0, 255]),
        ));

        let tiler = Tiler::new(TileConfig::default());
        let buf = std::io::Cursor::new(Vec::new());
        let mut zip_writer = ZipTileWriter::new(buf);

        let output = tiler
            .process_image(&img, &mut zip_writer, |_| {})
            .expect("processing should succeed");

        assert_eq!(output.max_zoom, 1);
        assert_eq!(output.total_tiles, 5);
    }

    #[test]
    fn test_process_rectangular_image_no_distortion() {
        let mut img = RgbaImage::new(1024, 512);
        for (x, _y, pixel) in img.enumerate_pixels_mut() {
            if x < 512 {
                *pixel = image::Rgba([255, 0, 0, 255]);
            } else {
                *pixel = image::Rgba([0, 0, 255, 255]);
            }
        }
        let dyn_img = DynamicImage::ImageRgba8(img);

        let tiler = Tiler::new(TileConfig {
            tile_size: 256,
            max_zoom: Some(2),
            ..Default::default()
        });
        let buf = std::io::Cursor::new(Vec::new());
        let mut zip_writer = ZipTileWriter::new(buf);
        let output = tiler
            .process_image(&dyn_img, &mut zip_writer, |_| {})
            .expect("processing should succeed");

        assert_eq!(output.width, 1024);
        assert_eq!(output.height, 512);
    }
}
