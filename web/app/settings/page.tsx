"use client";

import { Suspense, useState, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { toast } from "sonner";
import { PLAN_PRO } from "@/lib/plans";
import { listTileSets } from "@/lib/api";
import { useDeactivate } from "@/hooks/use-deactivate";
import { useTileDefaults } from "@/hooks/use-tile-defaults";
import { ApiKeyCard } from "@/components/api-key-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { User, AlertTriangle, Loader2, Star, Link2, Grid3X3, Download } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function SettingsContent() {
  const { data: session } = useSession();
  const deactivate = useDeactivate();
  const { defaults, update, reset: resetDefaults } = useTileDefaults();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isPro = session?.user?.plan === PLAN_PRO;

  async function handleDeactivate() {
    setConfirmDeactivate(false);
    deactivate.mutate(undefined, {
      onSuccess: () => signOut({ callbackUrl: "/" }),
    });
  }

  const handleExport = useCallback(async () => {
    if (!session) return;
    setExporting(true);
    try {
      const tilesets = await listTileSets(
        undefined,
        session.accessToken,
      ).catch(() => []);

      const data = {
        exported_at: new Date().toISOString(),
        account: {
          name: session.user.name,
          username: session.user.username,
          email: session.user.email,
          plan: session.user.plan,
        },
        tilesets,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tileforge-export-${session.user.username || "user"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported");
    } catch {
      toast.error("Failed to export data");
    } finally {
      setExporting(false);
    }
  }, [session]);

  if (!session) return null;

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-8 text-2xl font-bold">Settings</h1>

      {/* Profile */}
      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <User className="text-muted-foreground h-5 w-5" />
          <p className="text-sm font-medium">Profile</p>
        </div>
        <div className="flex items-center gap-4">
          {session.user.image && (
            <img
              src={session.user.image}
              alt="Avatar"
              className="h-12 w-12 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          <div>
            <p className="font-medium">{session.user.username || session.user.name}</p>
            {session.user.email && (
              <p className="text-muted-foreground text-sm">{session.user.email}</p>
            )}
            {isPro ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                <Star className="h-3 w-3 fill-amber-500" /> Pro
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Free plan</span>
            )}
          </div>
        </div>
      </div>

      {/* Connected Accounts */}
      <div className="mt-6 rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link2 className="text-muted-foreground h-5 w-5" />
          <p className="text-sm font-medium">Connected Accounts</p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GithubIcon className="h-5 w-5" />
            <span className="text-sm">@{session.user.username || session.user.name}</span>
          </div>
          <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
            Connected
          </span>
        </div>
      </div>

      {/* API Keys */}
      {isPro && (
        <div className="mt-6">
          <ApiKeyCard />
        </div>
      )}

      {/* Default Tile Settings */}
      <div className="mt-6 rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <Grid3X3 className="text-muted-foreground h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Default Tile Settings</p>
            <p className="text-muted-foreground text-xs">
              Pre-fill values when processing tiles
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Tile Size
            </label>
            <Select
              value={String(defaults.tileSize)}
              onValueChange={(v) => update({ tileSize: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="128">128</SelectItem>
                <SelectItem value="256">256</SelectItem>
                <SelectItem value="512">512</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Min Zoom
            </label>
            <Select
              value={String(defaults.minZoom)}
              onValueChange={(v) => update({ minZoom: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: defaults.maxZoom + 1 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Max Zoom
            </label>
            <Select
              value={String(defaults.maxZoom)}
              onValueChange={(v) => update({ maxZoom: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 13 }, (_, i) => (
                  <SelectItem key={i} value={String(i)} disabled={i < defaults.minZoom}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Projection
            </label>
            <Select
              value={defaults.projection}
              onValueChange={(v) => update({ projection: v as "flat" | "mercator" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat</SelectItem>
                <SelectItem value="mercator">Mercator</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Default Visibility
            </label>
            <Select
              value={defaults.defaultPublic ? "public" : "private"}
              onValueChange={(v) => update({ defaultPublic: v === "public" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={resetDefaults}>
            Reset to defaults
          </Button>
        </div>
      </div>

      {/* Export Data */}
      <div className="mt-6 rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <Download className="text-muted-foreground h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Export Data</p>
            <p className="text-muted-foreground text-xs">
              Download your account data and tileset metadata as JSON
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export Data
            </>
          )}
        </Button>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 rounded-lg border border-destructive/30 p-6">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm font-medium text-destructive">Danger Zone</p>
        </div>
        <p className="text-muted-foreground mb-4 text-sm">
          Deactivating your account will cancel your subscription, revoke API keys, and schedule
          data deletion in 30 days. Sign in again within 30 days to reactivate.
        </p>

        {deactivate.error && (
          <p className="mb-4 text-sm text-destructive">
            {deactivate.error.message}
          </p>
        )}

        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDeactivate(true)}
          disabled={deactivate.isPending}
        >
          {deactivate.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deactivating...
            </>
          ) : (
            "Deactivate Account"
          )}
        </Button>
      </div>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your subscription, revoke all API keys, and schedule your data for
              deletion in 30 days. You can reactivate by signing in again within that window.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
