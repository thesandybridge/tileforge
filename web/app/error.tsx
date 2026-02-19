"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="text-destructive mb-6 h-16 w-16 opacity-70" />
      <h1 className="text-4xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        An unexpected error occurred. Please try again.
      </p>
      <Button variant="secondary" className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
