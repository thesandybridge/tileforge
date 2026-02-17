use std::io::{Seek, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::TilerError;

/// Trait abstracting tile output format (ZIP, PMTiles, etc.).
///
/// Implementations receive encoded PNG bytes for each tile and are responsible
/// for writing them to the underlying storage format.
pub trait TileWriter {
    fn write_tile(&mut self, zoom: u32, x: u32, y: u32, png_bytes: &[u8]) -> Result<(), TilerError>;
    fn finish(&mut self) -> Result<(), TilerError>;
}

/// Writes tiles into a ZIP archive (the default output format).
pub struct ZipTileWriter<W: Write + Seek> {
    zip: Option<ZipWriter<W>>,
    inner: Option<W>,
    options: SimpleFileOptions,
}

impl<W: Write + Seek> ZipTileWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            zip: Some(ZipWriter::new(writer)),
            inner: None,
            options: SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        }
    }

    /// Consume the writer and return the underlying `W` (available after `finish()`).
    pub fn into_inner(self) -> Option<W> {
        self.inner
    }
}

impl<W: Write + Seek> TileWriter for ZipTileWriter<W> {
    fn write_tile(&mut self, zoom: u32, x: u32, y: u32, png_bytes: &[u8]) -> Result<(), TilerError> {
        let path = format!("{zoom}/{x}/{y}.png");
        let zip = self.zip.as_mut().expect("write_tile called after finish");
        zip.start_file(&path, self.options)?;
        zip.write_all(png_bytes)?;
        Ok(())
    }

    fn finish(&mut self) -> Result<(), TilerError> {
        if let Some(zip) = self.zip.take() {
            self.inner = Some(zip.finish()?);
        }
        Ok(())
    }
}

/// Writes tiles into a PMTiles archive.
///
/// Note: `PmTilesStreamWriter::finalize()` does not return the underlying writer,
/// so if you need the bytes, write to a file / tempfile and read it back.
pub struct PmTilesTileWriter<W: Write + Seek> {
    writer: Option<pmtiles::PmTilesStreamWriter<W>>,
}

impl<W: Write + Seek> PmTilesTileWriter<W> {
    pub fn new(writer: W, min_zoom: u8, max_zoom: u8) -> Result<Self, TilerError> {
        let stream_writer = pmtiles::PmTilesWriter::new(pmtiles::TileType::Png)
            .tile_compression(pmtiles::Compression::None)
            .internal_compression(pmtiles::Compression::Gzip)
            .min_zoom(min_zoom)
            .max_zoom(max_zoom)
            .create(writer)
            .map_err(|e| TilerError::Write(e.to_string()))?;
        Ok(Self { writer: Some(stream_writer) })
    }
}

impl<W: Write + Seek> TileWriter for PmTilesTileWriter<W> {
    fn write_tile(&mut self, zoom: u32, x: u32, y: u32, png_bytes: &[u8]) -> Result<(), TilerError> {
        let w = self.writer.as_mut().expect("write_tile called after finish");
        let coord = pmtiles::TileCoord::new(zoom as u8, x, y)
            .map_err(|e| TilerError::Write(e.to_string()))?;
        w.add_tile(coord, png_bytes)
            .map_err(|e| TilerError::Write(e.to_string()))?;
        Ok(())
    }

    fn finish(&mut self) -> Result<(), TilerError> {
        if let Some(w) = self.writer.take() {
            w.finalize()
                .map_err(|e| TilerError::Write(e.to_string()))?;
        }
        Ok(())
    }
}
