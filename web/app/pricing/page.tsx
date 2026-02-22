"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_PRO } from "@/lib/plans";
import { useCheckout } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";

interface PlanFeature {
  name: string;
  free: boolean | string;
  pro: boolean | string;
}

const features: PlanFeature[] = [
  { name: "Browser-based WASM processing", free: true, pro: true },
  { name: "Server-side processing", free: false, pro: true },
  { name: "Persistent tileset storage", free: false, pro: true },
  { name: "Public gallery listings", free: false, pro: true },
  { name: "API access", free: false, pro: true },
  { name: "Batch processing", free: "1 file at a time", pro: "3 parallel uploads" },
  { name: "Rate limit (tile processing)", free: "10/min", pro: "60/min" },
  { name: "Rate limit (downloads)", free: "30/min", pro: "120/min" },
  { name: "Storage quota", free: "None", pro: "1 GB" },
  { name: "PMTiles export", free: true, pro: true },
  { name: "ZIP export", free: true, pro: true },
  { name: "Mercator projection", free: true, pro: true },
  { name: "Flat projection", free: true, pro: true },
  { name: "TIFF/GeoTIFF support", free: false, pro: true },
];

function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-5 w-5 text-green-500" />
    ) : (
      <X className="h-5 w-5 text-muted-foreground/40" />
    );
  }
  return <span className="text-sm">{value}</span>;
}

export default function PricingPage() {
  const { data: session } = useSession();
  const checkout = useCheckout();
  const isPro = session?.user?.plan === PLAN_PRO;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Simple, transparent pricing</h1>
        <p className="text-muted-foreground mt-4 text-lg">
          Start free with browser processing. Upgrade for server power and persistent storage.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="mb-16 grid gap-6 md:grid-cols-2">
        {/* Free Plan */}
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">Free</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Perfect for trying out TileForge
            </p>
          </div>

          <ul className="mb-6 space-y-3">
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              Browser-based WASM processing
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              Export to ZIP and PMTiles
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              All projection modes
            </li>
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <X className="h-4 w-4 shrink-0" />
              No persistent storage
            </li>
          </ul>

          {session ? (
            isPro ? (
              <Button variant="outline" className="w-full" disabled>
                Current: Pro
              </Button>
            ) : (
              <Button variant="outline" className="w-full" disabled>
                Current Plan
              </Button>
            )
          ) : (
            <Link href="/api/auth/signin">
              <Button variant="outline" className="w-full">
                Get Started
              </Button>
            </Link>
          )}
        </div>

        {/* Pro Plan */}
        <div className="relative rounded-xl border-2 border-primary bg-card p-6">
          <div className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
            Recommended
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-semibold">Pro</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold">$9</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              For creators who need more power
            </p>
          </div>

          <ul className="mb-6 space-y-3">
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              Everything in Free
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              Server-side processing
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              1 GB persistent storage
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              API access for automation
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              3 parallel batch uploads
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              TIFF/GeoTIFF support
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              6x higher rate limits
            </li>
          </ul>

          {session ? (
            isPro ? (
              <Link href="/billing">
                <Button className="w-full">Manage Subscription</Button>
              </Link>
            ) : (
              <Button
                className="w-full"
                onClick={() => checkout.mutate()}
                disabled={checkout.isPending}
              >
                {checkout.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Upgrade to Pro"
                )}
              </Button>
            )
          ) : (
            <Link href="/api/auth/signin">
              <Button className="w-full">Get Started</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="rounded-xl border">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Feature comparison</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-6 py-3 text-left text-sm font-medium">Feature</th>
                <th className="px-6 py-3 text-center text-sm font-medium w-32">Free</th>
                <th className="px-6 py-3 text-center text-sm font-medium w-32">Pro</th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature, i) => (
                <tr
                  key={feature.name}
                  className={cn(
                    "border-b last:border-0",
                    i % 2 === 0 && "bg-muted/20"
                  )}
                >
                  <td className="px-6 py-3 text-sm">{feature.name}</td>
                  <td className="px-6 py-3 text-center">
                    <div className="flex justify-center">
                      <FeatureValue value={feature.free} />
                    </div>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <div className="flex justify-center">
                      <FeatureValue value={feature.pro} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ or extra info */}
      <div className="mt-12 text-center">
        <p className="text-muted-foreground text-sm">
          Questions? Check out our{" "}
          <Link href="/changelog" className="text-primary hover:underline">
            changelog
          </Link>{" "}
          or{" "}
          <a
            href="https://github.com/thesandybridge/tileforge"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
