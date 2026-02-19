"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Map, Globe, Grid3X3, ImageIcon } from "lucide-react";
import { API_URL } from "@/lib/api";
import { PLAN_PRO } from "@/lib/plans";
import { formatBytes, timeAgo } from "@/lib/utils";
import { usePublicTilesets } from "@/hooks/use-tilesets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeInlineBanner } from "@/components/upgrade-banner";
import { ScrollReveal } from "@/components/scroll-reveal";
import { TilesetGridSkeleton } from "@/components/tileset-skeleton";

export default function GalleryPage() {
  const { data: session } = useSession();
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = usePublicTilesets();
  const tilesets = data?.pages.flat() ?? [];
  const isFree = session?.user && session.user.plan !== PLAN_PRO;

  return (
    <div className="flex flex-1 flex-col py-10">
      <ScrollReveal>
        <header className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Public Tile Sets
          </h1>
          <p className="text-muted-foreground mt-2">
            Browse tile sets shared by the community.
          </p>
        </header>
      </ScrollReveal>

      <main className="mx-auto mt-10 max-w-4xl px-6">
        {isLoading && <TilesetGridSkeleton count={4} />}

        {error && (
          <p className="text-destructive text-center text-sm">{error.message}</p>
        )}

        {!isLoading && !error && tilesets.length === 0 && (
          <div className="text-muted-foreground py-16 text-center">
            <Map className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No public tile sets yet.</p>
            <p className="mt-1 text-sm">
              Processed tile sets marked as public will appear here.
            </p>
          </div>
        )}

        {isFree && !isLoading && tilesets.length > 0 && (
          <div className="mb-6">
            <UpgradeInlineBanner message="Want to create your own? Upgrade to Pro for server-side processing." />
          </div>
        )}

        {tilesets.length > 0 && (
          <ScrollReveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {tilesets.map((ts) => (
              <Link key={ts.id} href={`/tilesets/${encodeURIComponent(ts.slug)}`}>
                <Card className="border-border/50 hover:border-primary/30 corona-glow-hover overflow-hidden transition-colors">
                  <div className="bg-muted/50 relative aspect-video">
                    <img
                      src={`${API_URL}/api/tiles/${encodeURIComponent(ts.slug)}/thumbnail`}
                      alt={ts.name}
                      width={640}
                      height={360}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <div className="absolute inset-0 hidden items-center justify-center">
                      <ImageIcon className="text-muted-foreground/40 h-10 w-10" />
                    </div>
                  </div>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Map className="text-primary h-4 w-4" />
                      {ts.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-muted-foreground space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" />
                        <span>{ts.projection}</span>
                        <span className="text-muted-foreground/40">|</span>
                        <Grid3X3 className="h-3.5 w-3.5" />
                        <span>{ts.tile_size}px</span>
                      </div>
                      <p>
                        Zoom {ts.min_zoom}&ndash;{ts.max_zoom} &middot;{" "}
                        {ts.tile_count.toLocaleString()} tiles &middot;{" "}
                        {formatBytes(ts.size_bytes)}
                      </p>
                      <p className="text-muted-foreground/60 text-xs">
                        {timeAgo(ts.created_at)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {hasNextPage && (
            <div className="mt-6 text-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
          </ScrollReveal>
        )}
      </main>
    </div>
  );
}
