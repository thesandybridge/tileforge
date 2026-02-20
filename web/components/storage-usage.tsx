"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { BYTES_PER_GB } from "@/lib/constants";

function formatGB(bytes: number): string {
  return (bytes / BYTES_PER_GB).toFixed(2);
}

interface StorageUsageProps {
  used: number;
  quota: number;
}

export function StorageUsage({ used, quota }: StorageUsageProps) {
  if (quota <= 0) return null;

  const pct = Math.min((used / quota) * 100, 100);
  const critical = pct >= 90;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Storage</span>
        <span className={cn("tabular-nums", critical && "text-destructive font-medium")}>
          {formatGB(used)} / {formatGB(quota)} GB
        </span>
      </div>
      <Progress
        value={pct}
        className={cn("h-2", critical && "[&>[data-slot=progress-indicator]]:bg-destructive")}
      />
    </div>
  );
}
