"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MenuIcon, GalleryHorizontalEnd, FolderOpen, Newspaper, BookOpen, Github, Search } from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import { ThemePicker } from "@/components/theme-picker";
import { NotificationPanel } from "@/components/notification-panel";
import { StandaloneProcessingIndicator } from "@/components/processing-indicator";
import { useCommandPalette } from "@/components/command-palette";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="text-primary h-6 w-6" aria-hidden>
        <rect x="5" y="5" width="9" height="9" rx="2" fill="currentColor" />
        <rect x="18" y="5" width="9" height="9" rx="2" fill="currentColor" />
        <rect x="5" y="18" width="9" height="9" rx="2" fill="currentColor" />
        <rect x="19" y="19" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.5" />
      </svg>
      <span className="font-[family-name:var(--font-geist-mono)] text-primary text-sm font-medium">tileforge</span>
    </Link>
  );
}

function GitHubLink({ className }: { className?: string }) {
  return (
    <a
      href="https://github.com/thesandybridge/tileforge"
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label="GitHub"
    >
      <Github className="h-5 w-5" />
    </a>
  );
}

function NavLinks({ onClick }: { onClick?: () => void }) {
  const { data: session } = useSession();

  return (
    <>
      <Link
        href="/gallery"
        onClick={onClick}
        className="hover:text-foreground flex items-center gap-3 transition-colors"
      >
        <GalleryHorizontalEnd className="h-4 w-4" />
        Gallery
      </Link>
      {session?.user && (
        <Link
          href="/my-tilesets"
          onClick={onClick}
          className="hover:text-foreground flex items-center gap-3 transition-colors"
        >
          <FolderOpen className="h-4 w-4" />
          My Tilesets
        </Link>
      )}
      <Link
        href="/docs"
        onClick={onClick}
        className="hover:text-foreground flex items-center gap-3 transition-colors"
      >
        <BookOpen className="h-4 w-4" />
        Docs
      </Link>
      <Link
        href="/changelog"
        onClick={onClick}
        className="hover:text-foreground flex items-center gap-3 transition-colors"
      >
        <Newspaper className="h-4 w-4" />
        Changelog
      </Link>
    </>
  );
}

export function Navbar() {
  const { data: session } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { setOpen: setCommandPaletteOpen } = useCommandPalette();

  return (
    <nav className="border-border/50 border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
        {/* Logo - always visible */}
        <Logo />

        {/* Desktop navigation */}
        <div className="text-muted-foreground hidden items-center gap-4 text-sm md:flex">
          <NavLinks />
        </div>

        {/* Desktop right side */}
        <div className="hidden items-center gap-2 md:flex">
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground h-8 gap-2 px-2 text-xs"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="bg-muted text-muted-foreground pointer-events-none hidden h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium lg:inline-flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
          <GitHubLink className="text-muted-foreground hover:text-foreground transition-colors" />
          <ThemePicker />
          <NotificationPanel />
          {!session && <StandaloneProcessingIndicator />}
          <UserMenu />
        </div>

        {/* Mobile right side */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemePicker />
          <NotificationPanel />
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <MenuIcon className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-6 overflow-auto px-4 pt-2">
                {/* Navigation links */}
                <nav className="text-muted-foreground flex flex-col gap-4 text-base">
                  <NavLinks onClick={() => setMobileMenuOpen(false)} />
                </nav>

                {/* Divider */}
                <div className="bg-border h-px" />

                {/* User section */}
                <div className="flex flex-col gap-4">
                  <UserMenu mobile onAction={() => setMobileMenuOpen(false)} />
                </div>

                {/* Footer links */}
                <div className="mt-auto flex items-center gap-4 pb-4 pt-4">
                  <GitHubLink className="text-muted-foreground hover:text-foreground transition-colors" />
                  {!session && <StandaloneProcessingIndicator />}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
