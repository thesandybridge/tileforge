"use client";

import { Check, X, Loader2, Trash2, Download } from "lucide-react";
import { useTileforge, type QueuedFile } from "@/components/tileforge-context";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function QueueItem({ item, onRemove }: { item: QueuedFile; onRemove: () => void }) {
  const statusIcon = {
    queued: <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />,
    processing: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
    done: <Check className="h-4 w-4 text-green-500" />,
    error: <X className="h-4 w-4 text-destructive" />,
  };

  const handleDownload = () => {
    if (!item.zipBlob) return;
    const url = URL.createObjectURL(item.zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName.replace(/\.[^.]+$/, "_tiles.zip");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
        item.status === "error" && "border-destructive/30 bg-destructive/5",
        item.status === "done" && "border-green-500/30 bg-green-500/5",
        item.status === "processing" && "border-primary/30 bg-primary/5"
      )}
    >
      <div className="shrink-0">{statusIcon[item.status]}</div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.fileName}</p>
        {item.status === "processing" && item.progress && (
          <div className="mt-1 space-y-1">
            <Progress value={item.progress.percent} className="h-1.5" />
            <p className="text-muted-foreground text-xs">
              Zoom {item.progress.zoom} — {item.progress.tilesDone}/{item.progress.tilesTotal} tiles
            </p>
          </div>
        )}
        {item.status === "done" && item.durationMs && (
          <p className="text-muted-foreground text-xs">
            Done in {(item.durationMs / 1000).toFixed(1)}s
          </p>
        )}
        {item.status === "error" && item.error && (
          <p className="text-destructive text-xs">{item.error}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {item.status === "done" && item.zipBlob && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
        {(item.status === "queued" || item.status === "done" || item.status === "error") && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface BatchQueueProps {
  onProcessAll: () => void;
  disabled?: boolean;
}

export function BatchQueue({ onProcessAll, disabled }: BatchQueueProps) {
  const { queue, removeFromQueue, clearQueue, isProcessingQueue } = useTileforge();

  if (queue.length === 0) return null;

  const pendingCount = queue.filter((f) => f.status === "queued").length;
  const doneCount = queue.filter((f) => f.status === "done").length;
  const errorCount = queue.filter((f) => f.status === "error").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Batch Queue
          <span className="text-muted-foreground ml-2 font-normal">
            {pendingCount > 0 && `${pendingCount} pending`}
            {doneCount > 0 && `${pendingCount > 0 ? ", " : ""}${doneCount} done`}
            {errorCount > 0 && `${pendingCount > 0 || doneCount > 0 ? ", " : ""}${errorCount} failed`}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Button
              size="sm"
              onClick={onProcessAll}
              disabled={disabled || isProcessingQueue}
            >
              {isProcessingQueue ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Processing...
                </>
              ) : (
                `Process All (${pendingCount})`
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={clearQueue}
            disabled={isProcessingQueue}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {queue.map((item) => (
          <QueueItem
            key={item.id}
            item={item}
            onRemove={() => removeFromQueue(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
