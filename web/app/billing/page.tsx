"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { PLAN_PRO } from "@/lib/plans";
import { useCheckout, usePortalSession, usePlanRefresh } from "@/hooks/use-billing";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, Check, Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-user";
import { StorageUsage } from "@/components/storage-usage";
import { ApiKeyCard } from "@/components/api-key-card";

function BillingContent() {
  const { data: session } = useSession();
  const { upgraded, refreshing } = usePlanRefresh();
  const { data: user } = useCurrentUser();
  const checkout = useCheckout();
  const portal = usePortalSession();

  const isPro = session?.user?.plan === PLAN_PRO;
  const loading = checkout.isPending || portal.isPending;

  function handleUpgrade() {
    checkout.mutate();
  }

  function handleManage() {
    portal.mutate();
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-8 text-2xl font-bold">Billing</h1>
        <div className="rounded-lg border p-6 text-center">
          <CreditCard className="text-muted-foreground mx-auto mb-4 h-10 w-10" />
          <p className="text-muted-foreground mb-4 text-sm">
            Sign in to manage your plan and billing.
          </p>
          <Link href="/api/auth/signin">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-8 text-2xl font-bold">Billing</h1>

      {refreshing && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your upgrade...
        </div>
      )}

      {upgraded && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <Check className="h-4 w-4" />
          You&apos;ve been upgraded to Pro!
        </div>
      )}

      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <CreditCard className="text-muted-foreground h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Current plan</p>
            <p className="text-muted-foreground text-lg font-semibold capitalize">
              {session.user.plan}
            </p>
          </div>
        </div>

        {isPro ? (
          <div>
            <p className="text-muted-foreground mb-4 text-sm">
              You have access to server-side processing and persistent tilesets.
            </p>
            {user && user.storage_quota > 0 && (
              <div className="mb-4">
                <StorageUsage used={user.storage_used} quota={user.storage_quota} />
              </div>
            )}
            <Button onClick={handleManage} disabled={loading} variant="outline">
              <ExternalLink className="mr-2 h-4 w-4" />
              {portal.isPending ? "Loading..." : "Manage Subscription"}
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-muted-foreground mb-4 text-sm">
              Upgrade to Pro for server-side processing and persistent tilesets.
            </p>
            <Button onClick={handleUpgrade} disabled={loading}>
              {checkout.isPending ? "Loading..." : "Upgrade to Pro"}
            </Button>
          </div>
        )}
      </div>

      {isPro && (
        <div className="mt-6">
          <ApiKeyCard />
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
