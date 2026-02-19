"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import dynamic from "next/dynamic";
import type L from "leaflet";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import { useTilesets } from "@/hooks/use-tilesets";
import { getPmtilesUrl } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComparePageSkeleton } from "@/components/tileset-skeleton";

// Dynamic import for Leaflet components (SSR incompatible)
const CompareMap = dynamic(() => import("./compare-map"), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-square items-center justify-center rounded-xl border bg-muted/20">
      <p className="text-muted-foreground text-sm">Loading map...</p>
    </div>
  ),
});

interface TilesetSummary {
  id: string;
  slug: string;
  name: string;
  tile_size: number;
  max_zoom: number;
  projection: "flat" | "mercator";
}

function TilesetSelector({
  tilesets,
  value,
  onChange,
  label,
}: {
  tilesets: TilesetSummary[];
  value: string | null;
  onChange: (slug: string) => void;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        {label}
      </label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a tileset..." />
        </SelectTrigger>
        <SelectContent>
          {tilesets.map((ts) => (
            <SelectItem key={ts.id} value={ts.slug}>
              {ts.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function ComparePage() {
  const { data: session } = useSession();
  const { data, isLoading } = useTilesets();
  const tilesets = (data?.pages.flat() ?? []) as TilesetSummary[];

  const [leftSlug, setLeftSlug] = useState<string | null>(null);
  const [rightSlug, setRightSlug] = useState<string | null>(null);

  const leftTileset = tilesets.find((t) => t.slug === leftSlug) ?? null;
  const rightTileset = tilesets.find((t) => t.slug === rightSlug) ?? null;

  const { data: leftUrl } = useQuery({
    queryKey: ["pmtiles-url", leftSlug],
    queryFn: () => getPmtilesUrl(leftSlug!, session?.accessToken),
    enabled: !!leftSlug && !!session?.accessToken,
  });

  const { data: rightUrl } = useQuery({
    queryKey: ["pmtiles-url", rightSlug],
    queryFn: () => getPmtilesUrl(rightSlug!, session?.accessToken),
    enabled: !!rightSlug && !!session?.accessToken,
  });

  const [syncedView, setSyncedView] = useState<{ center: L.LatLng; zoom: number } | null>(null);
  const lastMoveSource = useRef<"left" | "right" | null>(null);

  const handleLeftMove = useCallback((center: L.LatLng, zoom: number) => {
    if (lastMoveSource.current !== "right") {
      lastMoveSource.current = "left";
      setSyncedView({ center, zoom });
    }
  }, []);

  const handleRightMove = useCallback((center: L.LatLng, zoom: number) => {
    if (lastMoveSource.current !== "left") {
      lastMoveSource.current = "right";
      setSyncedView({ center, zoom });
    }
  }, []);

  // Clear move source after sync settles
  useEffect(() => {
    if (syncedView) {
      const timeout = setTimeout(() => {
        lastMoveSource.current = null;
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [syncedView]);

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16">
        <p className="text-muted-foreground">Sign in to compare tilesets.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col py-10">
      <header className="mx-auto w-full max-w-6xl px-6">
        <Link
          href="/my-tilesets"
          className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My Tilesets
        </Link>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <GitCompareArrows className="h-8 w-8" />
          Compare Tilesets
        </h1>
        <p className="text-muted-foreground mt-2">
          View two tilesets side by side with synchronized pan and zoom.
        </p>
      </header>

      <main className="mx-auto mt-10 w-full max-w-6xl px-6">
        {isLoading ? (
          <ComparePageSkeleton />
        ) : tilesets.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-muted-foreground">
                No tilesets found. Create some tilesets to compare them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <TilesetSelector
                tilesets={tilesets}
                value={leftSlug}
                onChange={setLeftSlug}
                label="Left tileset"
              />
              <TilesetSelector
                tilesets={tilesets}
                value={rightSlug}
                onChange={setRightSlug}
                label="Right tileset"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <CompareMap
                pmtilesUrl={leftUrl ?? null}
                tileset={leftTileset}
                onMove={handleLeftMove}
                syncedView={lastMoveSource.current === "right" ? syncedView : null}
              />
              <CompareMap
                pmtilesUrl={rightUrl ?? null}
                tileset={rightTileset}
                onMove={handleRightMove}
                syncedView={lastMoveSource.current === "left" ? syncedView : null}
              />
            </div>

            {leftTileset && rightTileset && (
              <div className="grid gap-4 text-center text-sm sm:grid-cols-2">
                <div className="text-muted-foreground">
                  {leftTileset.name} &mdash; {leftTileset.tile_size}px, zoom 0-{leftTileset.max_zoom}
                </div>
                <div className="text-muted-foreground">
                  {rightTileset.name} &mdash; {rightTileset.tile_size}px, zoom 0-{rightTileset.max_zoom}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
