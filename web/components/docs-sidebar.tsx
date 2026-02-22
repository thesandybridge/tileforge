"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { NAV_GROUPS, UNGROUPED_NAV } from "@/lib/docs-nav";
import { getDocIcon } from "@/lib/docs-icons";
import { cn } from "@/lib/utils";

function NavGroup({ title, icon, items }: { title: string; icon?: string; items: typeof NAV_GROUPS[0]["items"] }) {
  const pathname = usePathname();
  const isActive = items.some((item) => item.href === pathname);
  const [open, setOpen] = useState(isActive);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors">
        {getDocIcon(icon)}
        <span className="flex-1 text-left">{title}</span>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="ml-2 border-l border-border pl-2 pt-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
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

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:block sticky top-[98px] self-start h-[calc(100vh-98px)] w-56 shrink-0 overflow-y-auto py-8 pr-4">
      <nav className="flex flex-col gap-1">
        {NAV_GROUPS.map((group) => (
          <NavGroup key={group.title} {...group} />
        ))}
        <div className="my-2 h-px bg-border" />
        {UNGROUPED_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
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
    </aside>
  );
}
