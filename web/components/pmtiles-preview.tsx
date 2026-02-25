"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { PMTiles } from "pmtiles";

interface PmtilesPreviewProps {
  pmtilesUrl: string;
  imageWidth: number;
  imageHeight: number;
  maxZoom: number;
  tileSize: number;
  projection: "flat" | "mercator" | "isometric";
}

function PmtilesTileLayer({
  pmtilesUrl,
  tileSize,
  maxZoom,
  projection,
}: {
  pmtilesUrl: string;
  tileSize: number;
  maxZoom: number;
  projection: "flat" | "mercator" | "isometric";
}) {
  const map = useMap();
  const layerRef = useRef<L.GridLayer | null>(null);
  const pmtilesRef = useRef<PMTiles | null>(null);

  useEffect(() => {
    const blobUrls: string[] = [];
    const pm = new PMTiles(pmtilesUrl);
    pmtilesRef.current = pm;

    function addLayer() {
      if (!map.getPane("tilePane")) return;

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }

      const PmLayer = L.GridLayer.extend({
        createTile(coords: L.Coords, done: (err: Error | null, tile: HTMLElement) => void) {
          const tile = L.DomUtil.create("img", "leaflet-tile") as HTMLImageElement;
          tile.width = tileSize;
          tile.height = tileSize;

          pm.getZxy(coords.z, coords.x, coords.y).then((result) => {
            if (result && result.data) {
              const blob = new Blob([result.data], { type: "image/png" });
              const url = URL.createObjectURL(blob);
              blobUrls.push(url);
              tile.src = url;
            }
            done(null, tile);
          }).catch(() => {
            done(null, tile);
          });

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
      const layer = new (PmLayer as any)(layerOptions);
      layer.addTo(map);
      layerRef.current = layer;
    }

    map.whenReady(addLayer);

    return () => {
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch { /* map may already be torn down */ }
        layerRef.current = null;
      }
      for (const url of blobUrls) {
        URL.revokeObjectURL(url);
      }
      pmtilesRef.current = null;
    };
  }, [map, pmtilesUrl, tileSize, maxZoom, projection]);

  return null;
}

export default function PmtilesPreview({
  pmtilesUrl,
  imageWidth,
  imageHeight,
  maxZoom,
  tileSize,
  projection,
}: PmtilesPreviewProps) {
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
          className="aspect-[4/3] w-full sm:aspect-square"
          style={{ background: "var(--background)" }}
          attributionControl={false}
        >
          <PmtilesTileLayer
            pmtilesUrl={pmtilesUrl}
            tileSize={tileSize}
            maxZoom={maxZoom}
            projection={projection}
          />
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
        className="aspect-[4/3] w-full sm:aspect-square"
          style={{ background: "var(--background)" }}
        attributionControl={false}
      >
        <PmtilesTileLayer
          pmtilesUrl={pmtilesUrl}
          tileSize={tileSize}
          maxZoom={maxZoom}
          projection={projection}
        />
      </MapContainer>
    </div>
  );
}
