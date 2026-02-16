"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { unzipSync } from "fflate";

interface TilePreviewProps {
  zipBlob: Blob;
  imageWidth: number;
  imageHeight: number;
  maxZoom: number;
  tileSize: number;
  projection: "flat" | "mercator";
}

function BlobTileLayer({
  tiles,
  tileSize,
  maxZoom,
  projection,
}: {
  tiles: Map<string, string>;
  tileSize: number;
  maxZoom: number;
  projection: "flat" | "mercator";
}) {
  const map = useMap();
  const layerRef = useRef<L.GridLayer | null>(null);

  const addLayer = useCallback(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const BlobLayer = L.GridLayer.extend({
      createTile(coords: L.Coords) {
        const tile = L.DomUtil.create(
          "img",
          "leaflet-tile",
        ) as HTMLImageElement;
        const key = `${coords.z}/${coords.x}/${coords.y}.png`;
        const url = tiles.get(key);
        if (url) {
          tile.src = url;
        }
        tile.width = tileSize;
        tile.height = tileSize;
        return tile;
      },
    });

    const layerOptions: Record<string, unknown> = {
      tileSize,
      noWrap: true,
      maxNativeZoom: maxZoom,
      minNativeZoom: 0,
    };

    if (projection === "flat") {
      layerOptions.bounds = [
        [-tileSize, 0],
        [0, tileSize],
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = new (BlobLayer as any)(layerOptions);
    layer.addTo(map);
    layerRef.current = layer;
  }, [map, tiles, tileSize, maxZoom, projection]);

  useEffect(() => {
    map.whenReady(addLayer);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, addLayer]);

  return null;
}

export default function TilePreview({
  zipBlob,
  imageWidth,
  imageHeight,
  maxZoom,
  tileSize,
  projection,
}: TilePreviewProps) {
  const [tiles, setTiles] = useState<Map<string, string> | null>(null);
  const tilesRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    zipBlob.arrayBuffer().then((buf) => {
      if (cancelled) return;
      const files = unzipSync(new Uint8Array(buf));
      const map = new Map<string, string>();
      for (const [path, data] of Object.entries(files)) {
        if (data.length > 0) {
          const blob = new Blob([data.slice()], { type: "image/png" });
          map.set(path, URL.createObjectURL(blob));
        }
      }
      tilesRef.current = map;
      setTiles(map);
    });

    return () => {
      cancelled = true;
      if (tilesRef.current) {
        for (const url of tilesRef.current.values()) {
          URL.revokeObjectURL(url);
        }
        tilesRef.current = null;
      }
    };
  }, [zipBlob]);

  if (!tiles) {
    return (
      <p className="text-muted-foreground mt-4 text-sm">
        Extracting tiles for preview...
      </p>
    );
  }

  const isMercator = projection === "mercator";

  if (isMercator) {
    const mercatorBounds: L.LatLngBoundsExpression = [
      [-85.051, -180],
      [85.051, 180],
    ];

    return (
      <div className="mt-4 overflow-hidden rounded-xl border">
        <MapContainer
          bounds={mercatorBounds}
          maxZoom={maxZoom}
          minZoom={0}
          zoomSnap={1}
          style={{ aspectRatio: "1 / 1", width: "100%", background: "var(--background)" }}
          attributionControl={false}
        >
          <BlobTileLayer tiles={tiles} tileSize={tileSize} maxZoom={maxZoom} projection={projection} />
        </MapContainer>
      </div>
    );
  }

  const maxDim = Math.max(imageWidth, imageHeight);
  const mapW = (imageWidth / maxDim) * tileSize;
  const mapH = (imageHeight / maxDim) * tileSize;
  const bounds: L.LatLngBoundsExpression = [
    [-mapH, 0],
    [0, mapW],
  ];

  return (
    <div className="mt-4 overflow-hidden rounded-xl border">
      <MapContainer
        bounds={bounds}
        maxZoom={maxZoom}
        minZoom={0}
        zoomSnap={1}
        crs={L.CRS.Simple}
        style={{ aspectRatio: "1 / 1", width: "100%", background: "var(--background)" }}
        attributionControl={false}
      >
        <BlobTileLayer tiles={tiles} tileSize={tileSize} maxZoom={maxZoom} projection={projection} />
      </MapContainer>
    </div>
  );
}
