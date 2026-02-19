"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { PMTiles } from "pmtiles";

interface TilesetSummary {
  tile_size: number;
  max_zoom: number;
}

function PmtilesTileLayer({
  pmtilesUrl,
  tileSize,
  maxZoom,
}: {
  pmtilesUrl: string;
  tileSize: number;
  maxZoom: number;
}) {
  const map = useMap();
  const layerRef = useRef<L.GridLayer | null>(null);

  useEffect(() => {
    const blobUrls: string[] = [];
    const pm = new PMTiles(pmtilesUrl);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layer = new (PmLayer as any)({
        tileSize,
        noWrap: true,
        maxNativeZoom: maxZoom,
        minNativeZoom: 0,
        bounds: [[-tileSize, 0], [0, tileSize]],
      });
      layer.addTo(map);
      layerRef.current = layer;
    }

    map.whenReady(addLayer);

    return () => {
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch { /* ignore */ }
        layerRef.current = null;
      }
      for (const url of blobUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [map, pmtilesUrl, tileSize, maxZoom]);

  return null;
}

function MapSyncController({
  onMove,
  syncedView,
}: {
  onMove: (center: L.LatLng, zoom: number) => void;
  syncedView: { center: L.LatLng; zoom: number } | null;
}) {
  const map = useMap();
  const isSyncing = useRef(false);

  useMapEvents({
    moveend: () => {
      if (!isSyncing.current) {
        onMove(map.getCenter(), map.getZoom());
      }
    },
  });

  useEffect(() => {
    if (syncedView) {
      isSyncing.current = true;
      map.setView(syncedView.center, syncedView.zoom, { animate: false });
      setTimeout(() => {
        isSyncing.current = false;
      }, 100);
    }
  }, [map, syncedView]);

  return null;
}

interface CompareMapProps {
  pmtilesUrl: string | null;
  tileset: TilesetSummary | null;
  onMove: (center: L.LatLng, zoom: number) => void;
  syncedView: { center: L.LatLng; zoom: number } | null;
}

export default function CompareMap({
  pmtilesUrl,
  tileset,
  onMove,
  syncedView,
}: CompareMapProps) {
  if (!pmtilesUrl || !tileset) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border bg-muted/20">
        <p className="text-muted-foreground text-sm">Select a tileset</p>
      </div>
    );
  }

  const bounds: L.LatLngBoundsExpression = [
    [-tileset.tile_size, 0],
    [0, tileset.tile_size],
  ];

  return (
    <div className="overflow-hidden rounded-xl border">
      <MapContainer
        bounds={bounds}
        maxZoom={tileset.max_zoom}
        minZoom={0}
        zoomSnap={1}
        crs={L.CRS.Simple}
        style={{ aspectRatio: "1 / 1", width: "100%", background: "var(--background)" }}
        attributionControl={false}
      >
        <PmtilesTileLayer
          pmtilesUrl={pmtilesUrl}
          tileSize={tileset.tile_size}
          maxZoom={tileset.max_zoom}
        />
        <MapSyncController onMove={onMove} syncedView={syncedView} />
      </MapContainer>
    </div>
  );
}
