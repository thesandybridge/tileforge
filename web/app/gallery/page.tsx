"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Map, Globe, Grid3X3, ImageIcon } from "lucide-react";
import { API_URL } from "@/lib/api";
import { PLAN_PRO } from "@/lib/plans";
import { usePublicTilesets } from "@/hooks/use-tilesets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { ScrollReveal } from "@/components/scroll-reveal";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function GalleryPage() {
  const { data: session } = useSession();
  const { data: tilesets = [], isLoading, error } = usePublicTilesets();
  const isFree = session?.user && session.user.plan !== PLAN_PRO;

  return (
    <div className="py-10">
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
        {isLoading && (
          <p className="text-muted-foreground text-center text-sm">
            Loading tile sets...
          </p>
        )}

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
            <UpgradeBanner message="Want to create your own? Upgrade to Pro for server-side processing." />
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
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <div className="hidden absolute inset-0 flex items-center justify-center">
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
          </ScrollReveal>
        )}
      </main>

      <footer className="text-muted-foreground mt-16 pb-8 text-center text-sm">
        &copy; {new Date().getFullYear()} &mdash; made with &hearts; by{" "}
        <a href="https://sandybridge.io" className="hover:text-foreground underline underline-offset-4 transition-colors">sandybridge</a>
      </footer>
    </div>
  );
}
