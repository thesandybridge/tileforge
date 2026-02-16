use std::f64::consts::PI;

/// Web Mercator latitude limit (atan(sinh(pi)) ≈ 85.051°).
pub const MAX_LAT: f64 = 1.4844222297453324; // atan(sinh(PI)) in radians

/// Convert a canvas normalized Y position (0=top, 1=bottom) to a source
/// normalized Y position (0=top, 1=bottom) in an equirectangular source
/// image spanning ±MAX_LAT.
///
/// The canvas Y uses Web Mercator spacing (equal tile rows = equal Mercator
/// latitude bands), while the source Y is linear in latitude.
pub fn canvas_y_to_source_y(t: f64) -> f64 {
    // canvas position → latitude (Web Mercator inverse)
    let lat = (PI * (1.0 - 2.0 * t)).sinh().atan();
    // latitude → normalized source Y (equirectangular over ±MAX_LAT)
    (MAX_LAT - lat) / (2.0 * MAX_LAT)
}

/// Compute the source Y range (normalized 0..1) that a given tile row covers
/// in a Mercator grid of size `grid × grid`.
///
/// Returns `(src_y_start_norm, src_y_end_norm)` where both are in [0, 1].
pub fn tile_row_source_range(tile_row: u32, grid: u32) -> (f64, f64) {
    let t_start = tile_row as f64 / grid as f64;
    let t_end = (tile_row + 1) as f64 / grid as f64;
    (canvas_y_to_source_y(t_start), canvas_y_to_source_y(t_end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boundary_top() {
        let y = canvas_y_to_source_y(0.0);
        assert!((y - 0.0).abs() < 1e-10, "t=0 should map to src_y=0, got {y}");
    }

    #[test]
    fn test_boundary_equator() {
        let y = canvas_y_to_source_y(0.5);
        assert!(
            (y - 0.5).abs() < 1e-10,
            "t=0.5 (equator) should map to src_y=0.5, got {y}"
        );
    }

    #[test]
    fn test_boundary_bottom() {
        let y = canvas_y_to_source_y(1.0);
        assert!((y - 1.0).abs() < 1e-10, "t=1 should map to src_y=1, got {y}");
    }

    #[test]
    fn test_symmetry() {
        // canvas_y_to_source_y(0.5 - d) + canvas_y_to_source_y(0.5 + d) == 1.0
        for &d in &[0.1, 0.2, 0.3, 0.4, 0.49] {
            let a = canvas_y_to_source_y(0.5 - d);
            let b = canvas_y_to_source_y(0.5 + d);
            assert!(
                (a + b - 1.0).abs() < 1e-10,
                "symmetry failed for d={d}: {a} + {b} != 1.0"
            );
        }
    }

    #[test]
    fn test_monotonic() {
        let mut prev = canvas_y_to_source_y(0.0);
        for i in 1..=100 {
            let t = i as f64 / 100.0;
            let y = canvas_y_to_source_y(t);
            assert!(y > prev, "not monotonic at t={t}: {y} <= {prev}");
            prev = y;
        }
    }

    #[test]
    fn test_tile_row_source_range_covers_full() {
        let grid = 4u32;
        let (start, _) = tile_row_source_range(0, grid);
        let (_, end) = tile_row_source_range(grid - 1, grid);
        assert!(start.abs() < 1e-10, "first tile row should start near 0");
        assert!((end - 1.0).abs() < 1e-10, "last tile row should end near 1");
    }

    #[test]
    fn test_tile_row_source_range_contiguous() {
        let grid = 8u32;
        for row in 0..grid - 1 {
            let (_, end) = tile_row_source_range(row, grid);
            let (next_start, _) = tile_row_source_range(row + 1, grid);
            assert!(
                (end - next_start).abs() < 1e-10,
                "gap between row {row} and {}: {end} vs {next_start}",
                row + 1
            );
        }
    }

    #[test]
    fn test_max_lat_value() {
        let computed = std::f64::consts::PI.sinh().atan();
        assert!(
            (MAX_LAT - computed).abs() < 1e-10,
            "MAX_LAT constant is wrong: {MAX_LAT} vs {computed}"
        );
    }
}
