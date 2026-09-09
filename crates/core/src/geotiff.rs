use std::io::Cursor;

use tiff::{decoder::Decoder, tags::Tag};

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
}
