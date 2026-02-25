"use client";

import React, { Suspense, useState, useCallback } from "react";
import { useSession, signOut, signIn } from "next-auth/react";
import { toast } from "sonner";
import { PLAN_PRO } from "@/lib/plans";
import { listTileSets } from "@/lib/api";
import { useLinkedAccounts, useUnlinkAccount } from "@/hooks/use-accounts";
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

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function ConnectedAccounts() {
  const { data: accounts, isLoading } = useLinkedAccounts();
  const unlink = useUnlinkAccount();

  const providerIcon: Record<string, React.ReactNode> = {
    github: <GithubIcon className="h-5 w-5" />,
    discord: <DiscordIcon className="h-5 w-5" />,
    google: <GoogleIcon className="h-5 w-5" />,
  };

  const providerLabel: Record<string, string> = {
    github: "GitHub",
    discord: "Discord",
    google: "Google",
  };

  const allProviders = ["github", "discord", "google"];
  const linkedProviders = accounts?.map((a) => a.provider) ?? [];
  const unlinkedProviders = allProviders.filter((p) => !linkedProviders.includes(p));

  if (isLoading) {
    return <div className="h-12 animate-pulse rounded bg-muted" />;
  }

  return (
    <div className="space-y-3">
      {accounts?.map((account) => (
        <div key={account.provider} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {providerIcon[account.provider] ?? null}
            <span className="text-sm">
              {account.username ? `@${account.username}` : providerLabel[account.provider]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
              Connected
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
              disabled={(accounts?.length ?? 0) <= 1 || unlink.isPending}
              onClick={() => unlink.mutate(account.provider, {
                onSuccess: () => toast.success(`${providerLabel[account.provider]} unlinked`),
                onError: (e) => toast.error(e.message),
              })}
            >
              Unlink
            </Button>
          </div>
        </div>
      ))}
      {unlinkedProviders.map((provider) => (
        <div key={provider} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {providerIcon[provider] ?? null}
            <span className="text-muted-foreground text-sm">{providerLabel[provider]}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => signIn(provider)}
          >
            Link
          </Button>
        </div>
      ))}
    </div>
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
        {session.user.id && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground mt-4 flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs transition-colors"
            onClick={() => {
              navigator.clipboard.writeText(session.user.id);
              toast.success("User ID copied");
            }}
          >
            <span className="text-muted-foreground/60">ID:</span> {session.user.id}
          </button>
        )}
      </div>

      {/* Connected Accounts */}
      <div className="mt-6 rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link2 className="text-muted-foreground h-5 w-5" />
          <p className="text-sm font-medium">Connected Accounts</p>
        </div>
        <ConnectedAccounts />
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
                    {String(i)}
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
                <SelectValue placeholder="0" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 13 }, (_, i) => (
                  <SelectItem key={i} value={String(i)} disabled={i < defaults.minZoom}>
                    {String(i)}
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
              onValueChange={(v) => update({ projection: v as "flat" | "mercator" | "isometric" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat</SelectItem>
                <SelectItem value="mercator">Mercator</SelectItem>
                <SelectItem value="isometric">Isometric</SelectItem>
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
