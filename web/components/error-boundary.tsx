"use client";

import { Component, type ReactNode, useState } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, Home, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toFriendlyError, type FriendlyError } from "@/lib/error-messages";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function TechnicalDetails({ error }: { error?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!error) return null;

  return (
    <div className="mt-4 w-full max-w-md">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
        Technical details
      </button>
      {expanded && (
        <pre className="mt-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
          {error}
        </pre>
      )}
    </div>
  );
}

function DefaultErrorUI({
  friendlyError,
  onReset,
}: {
  friendlyError: FriendlyError;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-6">
        <AlertTriangle className="text-destructive h-10 w-10" />
      </div>

      <h2 className="mb-2 text-xl font-semibold">{friendlyError.title}</h2>

      <p className="text-muted-foreground mb-2 max-w-md text-sm">
        {friendlyError.message}
      </p>

      {friendlyError.suggestion && (
        <p className="text-muted-foreground/80 mb-6 max-w-md text-sm italic">
          {friendlyError.suggestion}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={onReset} variant="default">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button onClick={() => (window.location.href = "/")} variant="outline">
          <Home className="mr-2 h-4 w-4" />
          Go home
        </Button>
        <Button
          onClick={() =>
            window.open(
              "https://github.com/thesandybridge/tileforge/issues",
              "_blank"
            )
          }
          variant="ghost"
          size="sm"
        >
          <Bug className="mr-2 h-4 w-4" />
          Report issue
        </Button>
      </div>

      <TechnicalDetails error={friendlyError.technical} />
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[error-boundary]", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const friendlyError = toFriendlyError(this.state.error?.message || "Unknown error");

      return <DefaultErrorUI friendlyError={friendlyError} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}

/**
 * Inline error display for use within components (not a boundary).
 * Use this for displaying processing errors, API errors, etc.
 */
export function InlineError({
  error,
  onRetry,
  onDismiss,
  className,
}: {
  error: string | Error;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const friendlyError = toFriendlyError(error);

  return (
    <div
      className={`rounded-lg border border-destructive/30 bg-destructive/5 p-4 ${className || ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-destructive/10 p-2 shrink-0">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">{friendlyError.title}</h4>
          <p className="text-muted-foreground text-sm mt-1">
            {friendlyError.message}
          </p>
          {friendlyError.suggestion && (
            <p className="text-muted-foreground/80 text-xs mt-2 italic">
              {friendlyError.suggestion}
            </p>
          )}

          {(onRetry || onDismiss) && (
            <div className="flex gap-2 mt-3">
              {onRetry && (
                <Button onClick={onRetry} size="sm" variant="outline">
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Retry
                </Button>
              )}
              {onDismiss && (
                <Button onClick={onDismiss} size="sm" variant="ghost">
                  Dismiss
                </Button>
              )}
            </div>
          )}

          <TechnicalDetails error={friendlyError.technical} />
        </div>
      </div>
    </div>
  );
}
