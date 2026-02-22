"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, MenuIcon } from "lucide-react";
import { Collapsible, ScrollArea } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NAV_GROUPS, UNGROUPED_NAV } from "@/lib/docs-nav";
import { getDocIcon } from "@/lib/docs-icons";
import { cn } from "@/lib/utils";

function usePageTitle() {
  const pathname = usePathname();
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.href === pathname) return item.title;
    }
  }
  for (const item of UNGROUPED_NAV) {
    if (item.href === pathname) return item.title;
  }
  return "Documentation";
}

function MobileNavGroup({ title, icon, items, onNavigate }: {
  title: string;
  icon?: string;
  items: typeof NAV_GROUPS[0]["items"];
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const isActive = items.some((item) => item.href === pathname);
  const [open, setOpen] = useState(isActive);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors">
        {getDocIcon(icon)}
        <span className="flex-1 text-left">{title}</span>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden">
        <div className="ml-3 border-l border-border pl-2 pt-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                pathname === item.href
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {getDocIcon(item.icon)}
              {item.title}
            </Link>
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function DocsHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const pageTitle = usePageTitle();

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <header className="border-border/50 sticky top-[57px] z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to app</span>
          </Button>
        </Link>

        <div className="flex items-center gap-2 text-sm">
          <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
            Docs
          </Link>
          {pathname !== "/docs" && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-foreground font-medium truncate">{pageTitle}</span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Mobile nav trigger */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden">
                <MenuIcon className="h-4 w-4" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetTitle className="text-sm">Documentation</SheetTitle>
              </SheetHeader>
              <ScrollArea.Root className="h-[calc(100vh-3.5rem)]">
                <ScrollArea.Viewport className="h-full w-full p-3">
                  <nav className="flex flex-col gap-1">
                    {NAV_GROUPS.map((group) => (
                      <MobileNavGroup key={group.title} {...group} onNavigate={closeMobileNav} />
                    ))}
                    <div className="my-2 h-px bg-border" />
                    {UNGROUPED_NAV.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMobileNav}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                          pathname === item.href
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        )}
                      >
                        {getDocIcon(item.icon)}
                        {item.title}
                      </Link>
                    ))}
                  </nav>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar orientation="vertical" className="w-2 p-0.5">
                  <ScrollArea.Thumb className="bg-border rounded-full" />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
