"use client";

import { useTileforge } from "@/components/tileforge-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LoaderCircle } from "lucide-react";

function useStatusText() {
  const { status, progress, error } = useTileforge();

  switch (status) {
    case "waking":
      return "Waking up server...";
    case "processing":
      if (progress) {
        return `Processing — Zoom ${progress.zoom} — ${progress.tilesDone}/${progress.tilesTotal} tiles (${Math.round(progress.percent)}%)`;
      }
      return "Processing...";
    case "done":
      return "Processing complete!";
    case "error":
      return error ?? "Processing failed";
    default:
      return null;
  }
}

/**
 * Ring overlay for the avatar. Shows a spinning border during processing,
 * red border on error.
 */
export function ProcessingRing() {
  const { status } = useTileforge();
  const isActive = status === "processing" || status === "waking";
  const isError = status === "error";

  if (!isActive && !isError) return null;

  return (
    <span
      className={`absolute inset-[-3px] rounded-full border-2 border-transparent ${
        isError
          ? "border-destructive"
          : "motion-safe:animate-spin border-t-primary motion-reduce:border-primary/40"
      }`}
    />
  );
}

/**
 * Wraps children with a tooltip that shows processing status.
 * Only renders the tooltip when there's active status to show.
 */
export function ProcessingTooltip({ children }: { children: React.ReactNode }) {
  const text = useStatusText();
  const { status } = useTileforge();
  const isError = status === "error";

  if (!text) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={isError ? "border-destructive/50 bg-destructive text-destructive-foreground" : ""}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Standalone processing indicator for signed-out users.
 * Shows a small spinner/icon with a tooltip.
 */
export function StandaloneProcessingIndicator() {
  const { status } = useTileforge();
  const text = useStatusText();
  const isActive = status === "processing" || status === "waking";
  const isError = status === "error";

  if (!isActive && !isError) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative flex h-8 w-8 items-center justify-center">
            {isActive && (
              <>
                <span className="absolute inset-0 motion-safe:animate-spin rounded-full border-2 border-transparent border-t-primary motion-reduce:border-primary/40" />
                <LoaderCircle className="text-primary h-4 w-4 motion-safe:animate-spin" />
              </>
            )}
            {isError && (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-destructive" />
                <span className="h-2 w-2 rounded-full bg-destructive" />
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={isError ? "border-destructive/50 bg-destructive text-destructive-foreground" : ""}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
