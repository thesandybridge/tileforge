"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function DefaultErrorUI({ error, onReset }: { error?: Error; onReset: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center px-6 py-16 text-center">
      <AlertTriangle className="text-destructive mb-4 h-12 w-12" />
      <h2 className="mb-2 text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground mb-6 max-w-md text-sm">
        {error?.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="flex gap-3">
        <Button onClick={onReset} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
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
    // Log to console in development
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return <DefaultErrorUI error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}
