"use client";

import { AlertTriangle } from "lucide-react";
import { useRateLimit } from "@/hooks/use-rate-limit";

export function RateLimitBanner() {
  const { isApproachingLimit, lowestRemaining } = useRateLimit();

  if (!isApproachingLimit() || !lowestRemaining) {
    return null;
  }

  const resetDate = new Date(lowestRemaining.reset * 1000);
  const now = new Date();
  const secondsUntilReset = Math.max(0, Math.ceil((resetDate.getTime() - now.getTime()) / 1000));

  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p>
        <span className="font-medium">Approaching rate limit.</span>{" "}
        {lowestRemaining.remaining} request{lowestRemaining.remaining !== 1 ? "s" : ""} remaining.
        {secondsUntilReset > 0 && (
          <span className="text-yellow-600/80 dark:text-yellow-400/80">
            {" "}Resets in {secondsUntilReset}s.
          </span>
        )}
      </p>
    </div>
  );
}
