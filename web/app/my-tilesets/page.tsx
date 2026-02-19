"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Map, Globe, Grid3X3, Trash2, ImageIcon, ArrowRight } from "lucide-react";
import { API_URL } from "@/lib/api";
import { PLAN_PRO } from "@/lib/plans";
import { useTilesets, useDeleteTileset } from "@/hooks/use-tilesets";
import { useCurrentUser } from "@/hooks/use-user";
import { StorageUsage } from "@/components/storage-usage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { UpgradeInlineBanner } from "@/components/upgrade-banner";
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

export default function MyTilesetsPage() {
  const { data: session } = useSession();
  const { data: tilesets, isLoading, error } = useTilesets();
  const { data: user } = useCurrentUser();
  const deleteTileset = useDeleteTileset();
  const isFree = session?.user && session.user.plan !== PLAN_PRO;


  return (
    <div className="py-10">
      <ScrollReveal>
        <header className="mx-auto max-w-4xl px-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            My Tilesets
          </h1>
          <p className="text-muted-foreground mt-2">
            Tilesets you&apos;ve created.
          </p>
        </header>
      </ScrollReveal>

      <main className="mx-auto mt-10 max-w-4xl px-6">
        {user && user.storage_quota > 0 && (
          <div className="mb-6">
            <StorageUsage used={user.storage_used} quota={user.storage_quota} />
          </div>
        )}
        {isLoading && (
          <p className="text-muted-foreground text-center text-sm">
            Loading your tilesets...
          </p>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error.message}</p>
        )}

        {!isLoading && !error && (!tilesets || tilesets.length === 0) && (
          <div className="text-muted-foreground py-16 text-center">
            <Map className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>No tilesets yet.</p>
            {isFree ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <p className="text-sm">
                  Upgrade to Pro to unlock server-side processing and persistent
                  tileset storage.
                </p>
                <Link
                  href="/billing"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors"
                >
                  Upgrade to Pro
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="mt-1 text-sm">
                Process an image with server mode to create a tileset.
              </p>
            )}
          </div>
        )}

        {tilesets && tilesets.length > 0 && (
          <ScrollReveal>
          <div className="space-y-6">
            {isFree && (
              <UpgradeInlineBanner message="Upgrade to Pro for server-side processing and persistent storage." />
            )}
          <div className="grid gap-4 sm:grid-cols-2">
            {tilesets.map((ts) => (
              <AlertDialog key={ts.id}>
                <Card className="border-border/50 corona-glow-hover group relative overflow-hidden">
                  <Link href={`/tilesets/${encodeURIComponent(ts.slug)}`}>
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
                        {ts.public && (
                          <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-normal">
                            public
                          </span>
                        )}
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
                  </Link>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                </Card>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete tileset</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &ldquo;{ts.name}&rdquo;?
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteTileset.mutate(ts.slug)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
          </div>
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
