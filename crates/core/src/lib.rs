pub mod mercator;
mod tiler;
pub mod streaming;
pub mod writer;
#[cfg(feature = "tiff")]
pub mod geotiff;

pub use streaming::{is_tiff, StreamingTiler};
pub use tiler::{
    BackgroundColor, Projection, ScaleMetadata, TileConfig, TileFormat, TileOutput, TileProgress, Tiler,
    TilerError, STREAMING_THRESHOLD,
};
pub use writer::{PmTilesTileWriter, SharedBuffer, TeeTileWriter, TileWriter, ZipTileWriter};
#[cfg(feature = "tiff")]
pub use geotiff::{read_geotiff_metadata, GeoTiffMetadata};
