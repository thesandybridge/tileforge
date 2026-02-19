import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function TilesetCardSkeleton() {
  return (
    <Card className="border-border/50 overflow-hidden">
      {/* Thumbnail */}
      <Skeleton className="aspect-video w-full rounded-none" />
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export function TilesetGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <TilesetCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TilesetDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Skeleton className="mt-1 h-6 w-6 rounded" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      {/* Details card */}
      <Card className="border-border/50 mt-8">
        <CardHeader>
          <Skeleton className="h-5 w-16" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-5 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview section */}
      <div className="mt-8">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-3 h-10 w-32" />
      </div>

      {/* Code snippets */}
      <div className="mt-8 space-y-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function TilesetSelectorSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

export function ComparePageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <TilesetSelectorSkeleton />
        <TilesetSelectorSkeleton />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-xl" />
        <Skeleton className="aspect-square w-full rounded-xl" />
      </div>
    </div>
  );
}

export function DropAreaSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="space-y-6 p-6 sm:p-8">
        {/* Drop zone skeleton */}
        <Skeleton className="h-40 w-full rounded-xl" />

        {/* Config row skeleton */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>

        {/* Button skeleton */}
        <div className="flex justify-center">
          <Skeleton className="h-11 w-28 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}
