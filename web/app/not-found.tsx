import Link from "next/link";
import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <Map className="text-muted-foreground mb-6 h-16 w-16 opacity-50" />
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="text-muted-foreground mt-2 text-lg">
        Page not found
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/" className="mt-6">
        <Button variant="secondary">Back to Home</Button>
      </Link>
    </div>
  );
}
