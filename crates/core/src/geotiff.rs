use std::io::Cursor;

use image::{DynamicImage, Rgba, RgbaImage};
use tiff::{decoder::{Decoder, DecodingResult}, tags::Tag, ColorType};

#[derive(Debug, Clone, PartialEq)]
pub struct GeoTiffMetadata {
    pub epsg: Option<u16>,
    /// Geographic or projected source bounds: west, south, east, north.
    pub bounds: Option<[f64; 4]>,
    pub pixel_scale: Option<[f64; 2]>,
}

impl GeoTiffMetadata {
    pub fn is_global_geographic(&self) -> bool {
        let Some([west, south, east, north]) = self.bounds else {
            return false;
        };
        self.epsg == Some(4326)
            && west <= -179.0
            && east >= 179.0
            && south <= -89.0
            && north >= 89.0
    }
}

/// Reads common GeoTIFF tags without decoding the raster. Plain TIFF files
/// return `None`, allowing callers to distinguish them from georeferenced data.
pub fn read_geotiff_metadata(bytes: &[u8]) -> Option<GeoTiffMetadata> {
    let mut decoder = Decoder::new(Cursor::new(bytes)).ok()?;
    let (width, height) = decoder.dimensions().ok()?;
    let scale = decoder.get_tag_f64_vec(Tag::ModelPixelScaleTag).ok();
    let tiepoint = decoder.get_tag_f64_vec(Tag::ModelTiepointTag).ok();
    let keys = decoder.get_tag_u16_vec(Tag::GeoKeyDirectoryTag).ok();

    if scale.is_none() && tiepoint.is_none() && keys.is_none() {
        return None;
    }

    Some(GeoTiffMetadata {
        epsg: keys.as_deref().and_then(epsg_from_geo_keys),
        bounds: bounds_from_tags(width, height, scale.as_deref(), tiepoint.as_deref()),
        pixel_scale: scale
            .as_deref()
            .and_then(|v| (v.len() >= 2).then(|| [v[0], v[1]])),
    })
}

/// Decode TIFF sample types that `image::load_from_memory` does not cover,
/// including the floating-point and multiband rasters common in GeoTIFFs.
pub fn decode_tiff_image(bytes: &[u8]) -> Result<DynamicImage, String> {
    let mut decoder = Decoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let (width, height) = decoder.dimensions().map_err(|e| e.to_string())?;
    let color = decoder.colortype().map_err(|e| e.to_string())?;
    let samples = match decoder.read_image().map_err(|e| e.to_string())? {
        DecodingResult::U8(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::U16(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::U32(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::U64(v) => v.into_iter().map(|x| x as f64).collect(),
        DecodingResult::I8(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::I16(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::I32(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::I64(v) => v.into_iter().map(|x| x as f64).collect(),
        DecodingResult::F16(v) => v.into_iter().map(|x| f64::from(f32::from(x))).collect(),
        DecodingResult::F32(v) => v.into_iter().map(f64::from).collect(),
        DecodingResult::F64(v) => v,
    };
    samples_to_rgba(width, height, color, &samples).map(DynamicImage::ImageRgba8)
}

fn samples_to_rgba(width: u32, height: u32, color: ColorType, samples: &[f64]) -> Result<RgbaImage, String> {
    let channels = match color {
        ColorType::Gray(_) | ColorType::Palette(_) => 1,
        ColorType::GrayA(_) => 2,
        ColorType::RGB(_) | ColorType::YCbCr(_) => 3,
        ColorType::RGBA(_) | ColorType::CMYK(_) => 4,
        ColorType::CMYKA(_) => 5,
        ColorType::Multiband { num_samples, .. } => usize::from(num_samples),
        _ => return Err(format!("unsupported TIFF color type: {color:?}")),
    };
    let pixels = usize::try_from(width).ok().and_then(|w| usize::try_from(height).ok().and_then(|h| w.checked_mul(h))).ok_or("TIFF dimensions are too large")?;
    if channels == 0 || samples.len() < pixels.saturating_mul(channels) { return Err("TIFF sample data is incomplete".into()); }

    let mut ranges = vec![(f64::INFINITY, f64::NEG_INFINITY); channels];
    for pixel in samples.chunks_exact(channels).take(pixels) {
        for (index, value) in pixel.iter().enumerate() {
            if value.is_finite() { ranges[index].0 = ranges[index].0.min(*value); ranges[index].1 = ranges[index].1.max(*value); }
        }
    }
    let scale = |value: f64, channel: usize| -> u8 {
        let (min, max) = ranges[channel];
        if !value.is_finite() { return 0; }
        if max <= min { return if max > 0.0 { 255 } else { 0 }; }
        (((value - min) / (max - min)) * 255.0).round().clamp(0.0, 255.0) as u8
    };
    let mut output = RgbaImage::new(width, height);
    for (target, source) in output.pixels_mut().zip(samples.chunks_exact(channels)) {
        *target = match color {
            ColorType::Gray(_) | ColorType::Palette(_) => { let v = scale(source[0], 0); Rgba([v, v, v, 255]) }
            ColorType::GrayA(_) => { let v = scale(source[0], 0); Rgba([v, v, v, scale(source[1], 1)]) }
            ColorType::RGBA(_) => Rgba([scale(source[0], 0), scale(source[1], 1), scale(source[2], 2), scale(source[3], 3)]),
            _ if channels >= 3 => Rgba([scale(source[0], 0), scale(source[1], 1), scale(source[2], 2), 255]),
            _ => { let v = scale(source[0], 0); Rgba([v, v, v, 255]) },
        };
    }
    Ok(output)
}

fn epsg_from_geo_keys(keys: &[u16]) -> Option<u16> {
    let count = *keys.get(3)? as usize;
    let (entries, _) = keys.get(4..)?.as_chunks::<4>();
    entries.iter().take(count).find_map(|entry| {
        // GeographicTypeGeoKey or ProjectedCSTypeGeoKey with an inline value.
        ((entry[0] == 2048 || entry[0] == 3072) && entry[1] == 0 && entry[3] > 0)
            .then_some(entry[3])
    })
}

fn bounds_from_tags(
    width: u32,
    height: u32,
    scale: Option<&[f64]>,
    tiepoint: Option<&[f64]>,
) -> Option<[f64; 4]> {
    let (scale, tie) = (scale?, tiepoint?);
    if scale.len() < 2 || tie.len() < 6 || scale[0] <= 0.0 || scale[1] <= 0.0 {
        return None;
    }
    let west = tie[3] - tie[0] * scale[0];
    let north = tie[4] + tie[1] * scale[1];
    Some([
        west,
        north - f64::from(height) * scale[1],
        west + f64::from(width) * scale[0],
        north,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_projected_epsg_key() {
        let keys = [1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, 3857];
        assert_eq!(epsg_from_geo_keys(&keys), Some(3857));
    }

    #[test]
    fn calculates_north_up_bounds() {
        assert_eq!(
            bounds_from_tags(
                100,
                50,
                Some(&[2.0, 3.0, 0.0]),
                Some(&[0.0, 0.0, 0.0, 10.0, 200.0, 0.0])
            ),
            Some([10.0, 50.0, 210.0, 200.0])
        );
    }

    #[test]
    fn only_global_geographic_rasters_enable_mercator_inference() {
        let global = GeoTiffMetadata {
            epsg: Some(4326),
            bounds: Some([-180.0, -90.0, 180.0, 90.0]),
            pixel_scale: None,
        };
        let crop = GeoTiffMetadata {
            bounds: Some([-80.0, 35.0, -70.0, 45.0]),
            ..global.clone()
        };
        assert!(global.is_global_geographic());
        assert!(!crop.is_global_geographic());
    }

    #[test]
    fn renders_float_elevation_samples() {
        let image = samples_to_rgba(2, 2, ColorType::Gray(32), &[10.0, 20.0, 30.0, 40.0]).unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(image.get_pixel(1, 1).0, [255, 255, 255, 255]);
    }
}
