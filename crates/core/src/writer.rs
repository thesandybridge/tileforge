use std::cell::RefCell;
use std::io::{Seek, Write};
use std::rc::Rc;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::TilerError;

/// A shared buffer that can be used with writers that consume ownership.
/// After the writer is done, the buffer contents can be extracted.
#[derive(Clone)]
pub struct SharedBuffer {
    inner: Rc<RefCell<Vec<u8>>>,
}

impl SharedBuffer {
    pub fn new() -> Self {
        Self {
            inner: Rc::new(RefCell::new(Vec::new())),
        }
    }

    /// Get the contents of the buffer (clones the data).
    pub fn take_bytes(&self) -> Vec<u8> {
        std::mem::take(&mut *self.inner.borrow_mut())
    }

    /// Get a cursor for writing.
    pub fn cursor(&self) -> SharedBufferCursor {
        SharedBufferCursor {
            buffer: self.inner.clone(),
            position: 0,
        }
    }
}

impl Default for SharedBuffer {
    fn default() -> Self {
        Self::new()
    }
}

/// A cursor that writes to a SharedBuffer.
pub struct SharedBufferCursor {
    buffer: Rc<RefCell<Vec<u8>>>,
    position: u64,
}

impl Write for SharedBufferCursor {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut inner = self.buffer.borrow_mut();
        let pos = self.position as usize;

        // Extend buffer if needed
        if pos + buf.len() > inner.len() {
            inner.resize(pos + buf.len(), 0);
        }

        inner[pos..pos + buf.len()].copy_from_slice(buf);
        self.position += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Seek for SharedBufferCursor {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        let inner = self.buffer.borrow();
        let len = inner.len() as i64;
        drop(inner);

        let new_pos = match pos {
            std::io::SeekFrom::Start(p) => p as i64,
            std::io::SeekFrom::End(p) => len + p,
            std::io::SeekFrom::Current(p) => self.position as i64 + p,
        };

        if new_pos < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "seek to negative position",
            ));
        }

        self.position = new_pos as u64;
        Ok(self.position)
    }
}

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

/// Writes tiles into two `TileWriter`s simultaneously (fan-out).
///
/// This eliminates the need for a second processing pass when you want both
/// ZIP and PMTiles output from the same image.
pub struct TeeTileWriter<A: TileWriter, B: TileWriter> {
    a: A,
    b: B,
}

impl<A: TileWriter, B: TileWriter> TeeTileWriter<A, B> {
    pub fn new(a: A, b: B) -> Self {
        Self { a, b }
    }

    /// Consume the tee and return both inner writers.
    pub fn into_inner(self) -> (A, B) {
        (self.a, self.b)
    }
}

impl<A: TileWriter, B: TileWriter> TileWriter for TeeTileWriter<A, B> {
    fn write_tile(&mut self, zoom: u32, x: u32, y: u32, png_bytes: &[u8]) -> Result<(), TilerError> {
        self.a.write_tile(zoom, x, y, png_bytes)?;
        self.b.write_tile(zoom, x, y, png_bytes)?;
        Ok(())
    }

    fn finish(&mut self) -> Result<(), TilerError> {
        self.a.finish()?;
        self.b.finish()?;
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
