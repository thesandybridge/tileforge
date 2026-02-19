use clap::Parser;
use std::fs;
use std::path::PathBuf;
use tileforge_core::{StreamingTiler, TileConfig, Tiler, ZipTileWriter};

#[derive(Parser)]
#[command(name = "tileforge", about = "Slice images into XYZ tile sets")]
struct Args {
    /// Path to the source image
    input: PathBuf,

    /// Output zip file path
    #[arg(short, long, default_value = "tiles.zip")]
    output: PathBuf,

    /// Tile size in pixels
    #[arg(short, long, default_value_t = 256)]
    tile_size: u32,

    /// Minimum zoom level (default: 0)
    #[arg(long)]
    min_zoom: Option<u32>,

    /// Maximum zoom level (auto-calculated if omitted)
    #[arg(long)]
    max_zoom: Option<u32>,

    /// Force streaming mode (row-by-row decode, lower memory)
    #[arg(long)]
    streaming: bool,

    /// Force naive mode (full decode, faster for small images)
    #[arg(long, conflicts_with = "streaming")]
    naive: bool,

    /// Map projection: flat (equirectangular) or mercator (Web Mercator)
    #[arg(long, default_value = "flat")]
    projection: String,
}

fn progress_callback(p: tileforge_core::TileProgress) {
    eprint!(
        "\rProcessing: z{} ({}/{} tiles, {:.0}%)",
        p.zoom,
        p.tiles_done,
        p.tiles_total,
        (p.tiles_done as f64 / p.tiles_total as f64) * 100.0
    );
}

fn main() {
    let args = Args::parse();

    let bytes = fs::read(&args.input).unwrap_or_else(|e| {
        eprintln!("Failed to read {}: {e}", args.input.display());
        std::process::exit(1);
    });

    let projection = match args.projection.as_str() {
        "flat" => tileforge_core::Projection::Flat,
        "mercator" => tileforge_core::Projection::Mercator,
        "isometric" => tileforge_core::Projection::Isometric,
        other => {
            eprintln!("Unknown projection '{other}'. Use 'flat', 'mercator', or 'isometric'.");
            std::process::exit(1);
        }
    };

    let config = TileConfig {
        tile_size: args.tile_size,
        min_zoom: args.min_zoom,
        max_zoom: args.max_zoom,
        projection,
        scale: None,
        background: None,
        scale_metadata: None,
    };

    let file = fs::File::create(&args.output).unwrap_or_else(|e| {
        eprintln!("Failed to create {}: {e}", args.output.display());
        std::process::exit(1);
    });
    let mut zip_writer = ZipTileWriter::new(file);

    let output = if args.streaming {
        let is_png = tileforge_core::streaming::read_png_dimensions(&bytes).is_some();
        let tiler = StreamingTiler::new(config);
        if is_png {
            eprintln!("Mode: streaming (PNG row-by-row)");
            tiler
                .process_png(std::io::BufReader::new(std::io::Cursor::new(&bytes)), &mut zip_writer, progress_callback)
                .unwrap_or_else(|e| {
                    eprintln!("\nFailed to process image: {e}");
                    std::process::exit(1);
                })
        } else {
            eprintln!("Mode: streaming (decode + strip extraction)");
            let img = image::load_from_memory(&bytes).unwrap_or_else(|e| {
                eprintln!("Failed to decode image: {e}");
                std::process::exit(1);
            });
            tiler
                .process_image(&img, &mut zip_writer, progress_callback)
                .unwrap_or_else(|e| {
                    eprintln!("\nFailed to process image: {e}");
                    std::process::exit(1);
                })
        }
    } else if args.naive {
        eprintln!("Mode: naive");
        let tiler = Tiler::new(config);
        tiler
            .process_bytes_naive(&bytes, &mut zip_writer, progress_callback)
            .unwrap_or_else(|e| {
                eprintln!("\nFailed to process image: {e}");
                std::process::exit(1);
            })
    } else {
        let is_streaming = tileforge_core::streaming::should_use_streaming(
            &bytes,
            tileforge_core::STREAMING_THRESHOLD,
        );
        eprintln!("Mode: auto ({})", if is_streaming { "streaming" } else { "naive" });
        let tiler = Tiler::new(config);
        tiler
            .process_bytes(&bytes, &mut zip_writer, progress_callback)
            .unwrap_or_else(|e| {
                eprintln!("\nFailed to process image: {e}");
                std::process::exit(1);
            })
    };

    eprintln!();
    println!(
        "Image: {}x{} | Tile size: {} | Zoom: {}-{} | Tiles: {} → {}",
        output.width,
        output.height,
        args.tile_size,
        output.min_zoom,
        output.max_zoom,
        output.total_tiles,
        args.output.display()
    );
}
