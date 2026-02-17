"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { UserMenu } from "@/components/user-menu";

export function Navbar() {
  const { data: session } = useSession();

  return (
    <nav className="border-border/50 border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" className="text-primary h-6 w-6" aria-hidden>
              <rect x="1" y="1" width="13.5" height="13.5" rx="3" fill="currentColor" />
              <rect x="17.5" y="1" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.7" />
              <rect x="1" y="17.5" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.7" />
              <rect x="17.5" y="17.5" width="13.5" height="13.5" rx="3" fill="currentColor" opacity="0.4" />
            </svg>
            <span className="text-sm font-semibold">Tileforge</span>
          </Link>
          <div className="text-muted-foreground flex items-center gap-4 text-sm">
            <Link href="/gallery" className="hover:text-foreground transition-colors">Gallery</Link>
            {session?.user && (
              <Link href="/my-tilesets" className="hover:text-foreground transition-colors">My Tilesets</Link>
            )}
          </div>
        </div>
        <UserMenu />
      </div>
    </nav>
  );
}
