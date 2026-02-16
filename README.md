<p align="center">
  <img src="web/app/icon.svg" width="80" height="80" alt="Tileforge logo" />
</p>

<h1 align="center">Tileforge</h1>

<p align="center">
  Slice any image into <a href="https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames">XYZ map tiles</a> — entirely in your browser, powered by Rust and WebAssembly.
</p>

<p align="center">
  <a href="https://github.com/thesandybridge/tileforge/actions"><img src="https://github.com/thesandybridge/tileforge/actions/workflows/wasm-build.yml/badge.svg" alt="WASM Build" /></a>
  <img src="https://img.shields.io/badge/rust-stable-orange" alt="Rust" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
</p>

---

## What is Tileforge?

Tileforge takes a single large image and slices it into a directory tree of small square tiles organized as `{zoom}/{x}/{y}.png` — the standard XYZ tile format used by Leaflet, Mapbox GL, OpenLayers, and every major mapping library.

**No server-side processing.** The web UI runs the entire pipeline in a Web Worker using compiled-to-WASM Rust. Your images never leave your machine.

There's also a native CLI for batch processing and scripting.

---

## Features

- **Browser-based** — drop an image, configure, download a ZIP of tiles. Zero server uploads.
- **Rust + WebAssembly** — native-speed image processing compiled to WASM via `wasm-pack`.
- **Three processing strategies** — automatically selected based on image size:
  | Strategy | When | Memory |
  |---|---|---|
  | **Naive** | Small images (< 256 MB decoded) | Full decode + resize per zoom |
  | **Streaming PNG** | Large PNGs | Row-by-row decode, never holds full image |
  | **Strip extraction** | Large JPEG/WebP | Full decode, but no per-zoom resized copies |
- **Flat and Mercator projections** — flat/equirectangular for fictional maps and artwork; Web Mercator (EPSG:3857) for real-world geographic maps from equirectangular sources.
- **Interactive tile preview** — rendered with Leaflet directly from the in-memory ZIP, no file I/O.
- **Configurable** — tile size (128/256/512), min/max zoom, projection type.
- **Pyramid builder** — lower zoom levels are built by merging 4 tiles into 1, cascading from max zoom down to zoom 0.
- **CLI tool** — native binary for scripting and batch jobs.
- **Dark mode** — green-tinted dark theme with amber accents (light mode supported too).

---

## Architecture

```
tileforge/
├── Cargo.toml                   # Workspace root
├── crates/
│   ├── core/src/
│   │   ├── lib.rs               # Public API: TileConfig, Tiler, StreamingTiler, Projection
│   │   ├── tiler.rs             # Naive tiler (full decode + resize per zoom)
│   │   ├── streaming.rs         # Streaming tiler: row-by-row PNG, strip-based extraction, pyramid
│   │   └── mercator.rs          # Web Mercator math (canvas ↔ source Y mapping)
│   └── wasm/src/lib.rs          # wasm-bindgen wrapper
├── cli/src/main.rs              # Native CLI binary
└── web/                         # Next.js 16 + Tailwind v4 + shadcn/ui
    ├── app/
    │   ├── layout.tsx           # Root layout, SEO metadata, JSON-LD
    │   ├── page.tsx             # Main UI: drop zone, config, progress, download
    │   ├── sitemap.ts           # Dynamic sitemap generation
    │   └── robots.ts            # Robots.txt generation
    ├── components/
    │   └── tile-preview.tsx     # Leaflet-based in-memory tile viewer
    ├── lib/
    │   ├── use-tileforge.ts     # React hook: worker lifecycle, progress, state machine
    │   └── worker-protocol.ts   # TypeScript message types
    └── public/
        ├── tileforge.worker.js  # Standalone Web Worker (importScripts, no bundler)
        └── wasm/                # wasm-pack output (--target no-modules)
```

### Why the Worker lives in `public/`

Turbopack cannot bundle WASM imports inside Web Workers. The worker and WASM glue are plain scripts in `public/`, loaded via `importScripts()`. The React hook creates the worker with `new Worker("/tileforge.worker.js")`.

---

## Getting Started

### Prerequisites

- **Rust** (stable) — [rustup.rs](https://rustup.rs/)
- **wasm-pack** — `cargo install wasm-pack`
- **Node.js** 20+ and **npm**

### Clone and build

```bash
git clone https://github.com/thesandybridge/tileforge.git
cd tileforge
```

#### Build the Rust library and CLI

```bash
cargo build --release
```

#### Build WASM for the web UI

```bash
cd crates/wasm
wasm-pack build --target no-modules --out-dir ../../web/public/wasm --release
```

#### Run the web UI

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## CLI Usage

```bash
tileforge <IMAGE> [OPTIONS]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `-o, --output <PATH>` | `tiles.zip` | Output ZIP file path |
| `-t, --tile-size <PX>` | `256` | Tile size in pixels |
| `--min-zoom <N>` | `0` | Minimum zoom level |
| `--max-zoom <N>` | auto | Maximum zoom level (calculated from image dimensions) |
| `--projection <TYPE>` | `flat` | `flat` or `mercator` |
| `--streaming` | | Force streaming mode (lower memory) |
| `--naive` | | Force naive mode (faster for small images) |

### Examples

```bash
# Basic usage — auto-selects processing strategy
tileforge world_map.png -o tiles.zip

# Mercator projection for an equirectangular world map
tileforge equirect_world.png -o mercator_tiles.zip --projection mercator

# Custom tile size and zoom range
tileforge large_image.jpg -o tiles.zip --tile-size 512 --max-zoom 6

# Force streaming mode for a huge PNG
tileforge huge.png -o tiles.zip --streaming
```

### Output format

```
tiles.zip
├── 0/0/0.png        # Zoom 0: 1 tile
├── 1/0/0.png        # Zoom 1: 4 tiles
├── 1/0/1.png
├── 1/1/0.png
├── 1/1/1.png
├── 2/0/0.png        # Zoom 2: 16 tiles
├── ...
```

Compatible with Leaflet, Mapbox GL JS, OpenLayers, MapLibre, Google Maps, and any library that supports XYZ tile URLs.

---

## Web UI

1. **Drop or browse** for an image (PNG, JPEG, WebP)
2. **Configure** tile size, max zoom level, and projection
3. **Process** — runs entirely in a Web Worker via WASM
4. **Preview** — interactive Leaflet map rendered from the in-memory tiles
5. **Download** — single ZIP file ready to deploy

The web UI shows real-time progress (zoom level, tile count, percentage) and post-processing stats (duration, tile count, peak memory estimate).

---

## Projections

### Flat (default)

Standard equirectangular mapping. Each zoom level uniformly scales the source image to fit the tile grid. Suitable for:
- Fantasy/game maps
- Floor plans and architectural drawings
- Artwork and illustrations
- Any non-geographic image

### Mercator

Web Mercator (EPSG:3857) Y-axis remapping. Assumes the source image is an equirectangular (plate carree) projection spanning approximately ±85.051° latitude. Tiles are warped so that equal-size tile rows cover equal Mercator-projected latitude bands. Suitable for:
- Real-world geographic maps
- Satellite imagery in equirectangular format
- Any source intended for use with standard web mapping libraries

The X axis is unchanged between projections — both are linear in longitude.

---

## How It Works

### Processing strategies

**Naive** (small images): Decode the full image, resize to each zoom level's canvas size, crop tiles from the canvas. Simple and fast for images under ~256 MB decoded.

**Streaming PNG** (large PNGs): Decode the PNG row-by-row using the `png` crate. For each tile row at max zoom, decode only the source rows needed, extract tiles, then release the rows. Lower zoom levels are built by merging tiles (4 → 1) using a pyramid builder. Peak memory is roughly one tile row's worth of source data.

**Strip extraction** (large non-PNGs): Fully decode the image (unavoidable for JPEG), but never create resized copies. Each tile is individually cropped and resampled from the source. Pyramid builder handles lower zoom levels.

### Pyramid builder

Instead of creating full-canvas images at every zoom level, the pyramid builder merges tiles bottom-up:
1. Generate all tiles at max zoom
2. Every pair of tile rows triggers a merge: 4 tiles (2x2) are composited into a 2x tile and downscaled to 1 tile at zoom-1
3. Merges cascade recursively down to zoom 0

This means lower zoom levels are generated with no additional source image access.

---

## CI/CD

A GitHub Actions workflow (`.github/workflows/wasm-build.yml`) automatically rebuilds the WASM output whenever files under `crates/` change on the `main` branch. The built artifacts are committed back to `web/public/wasm/`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Core library | Rust (`image`, `png`, `zip`, `thiserror`) |
| WASM bridge | `wasm-bindgen`, `js-sys`, `wasm-pack` |
| CLI | Rust + `clap` |
| Web framework | Next.js 16 (App Router, Turbopack) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Map preview | Leaflet + react-leaflet |
| ZIP (browser) | fflate |
| CI | GitHub Actions |

---

## License

MIT

---

<p align="center">
  Made with ♥ by <a href="https://github.com/thesandybridge">sandybridge</a>
</p>
