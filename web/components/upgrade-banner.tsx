import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function UpgradeBanner({ message }: { message: string }) {
  return (
    <div className="border-primary/20 bg-primary/5 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <p className="text-sm">{message}</p>
      <Link
        href="/billing"
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
      >
        Upgrade to Pro
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
