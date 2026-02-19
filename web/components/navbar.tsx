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
            <Link href="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/thesandybridge/tileforge"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="GitHub"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
            </svg>
          </a>
          <ThemeToggle />
          <NotificationPanel />
          {!session && <StandaloneProcessingIndicator />}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
