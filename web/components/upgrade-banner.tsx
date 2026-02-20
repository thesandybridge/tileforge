"use client";

import { useState, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCheckout } from "@/hooks/use-billing";
import { PLAN_PRO } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { X, Zap, Server, Database, Key, Loader2 } from "lucide-react";

const STORAGE_KEY = "tileforge:upgrade-banner-dismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Full upgrade CTA for the home page — dismissible for 7 days via localStorage.
 */
export function UpgradeBanner() {
  const { data: session } = useSession();
  const checkout = useCheckout();
  const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ts = Number(raw);
      if (Date.now() - ts < DISMISS_DURATION_MS) return;
    }
    setDismissed(false);
  }, []);

  // Don't show for Pro users or if dismissed
  if (session?.user?.plan === PLAN_PRO || dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setDismissed(true);
  }

  function handleUpgrade() {
    if (!session) {
      signIn("github");
    } else {
      checkout.mutate();
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="px-6 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary fill-primary" />
            <h3 className="text-lg font-semibold">Upgrade to Pro</h3>
          </div>

          <p className="text-muted-foreground text-sm max-w-md">
            Unlock server-side processing for large images, persistent tilesets, PMTiles output, and API access.
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            {[
              { icon: Server, label: "Server processing" },
              { icon: Database, label: "Persistent storage" },
              { icon: Key, label: "API access" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-3 py-1 text-xs text-muted-foreground"
              >
                <Icon className="h-3 w-3" />
                {label}
              </span>
            ))}
          </div>

          <Button onClick={handleUpgrade} disabled={checkout.isPending} size="sm">
            {checkout.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                {session ? "Upgrade now" : "Sign in to upgrade"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline banner for gated features (e.g. billing page, settings).
 */
export function UpgradeInlineBanner({ message }: { message: string }) {
  return (
    <div className="border-primary/20 bg-primary/5 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <p className="text-sm">{message}</p>
      <Link
        href="/billing"
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
      >
        Upgrade to Pro
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
