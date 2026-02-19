"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationPanel } from "@/components/notification-panel";
import { StandaloneProcessingIndicator } from "@/components/processing-indicator";

export function Navbar() {
  const { data: session } = useSession();

  return (
    <nav className="border-border/50 border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" className="text-primary h-6 w-6" aria-hidden>
              <rect x="5" y="5" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="18" y="5" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="5" y="18" width="9" height="9" rx="2" fill="currentColor" />
              <rect x="19" y="19" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.5" />
            </svg>
            <span className="font-[family-name:var(--font-geist-mono)] text-primary text-sm font-medium">tileforge</span>
          </Link>
          <div className="text-muted-foreground flex items-center gap-4 text-sm">
            <Link href="/gallery" className="hover:text-foreground transition-colors">Gallery</Link>
            {session?.user && (
              <Link href="/my-tilesets" className="hover:text-foreground transition-colors">My Tilesets</Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NotificationPanel />
          {!session && <StandaloneProcessingIndicator />}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
