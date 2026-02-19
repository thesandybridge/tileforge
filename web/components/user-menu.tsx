"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { CreditCard, LogIn, LogOut, Map, Settings, Star, User } from "lucide-react";
import { PLAN_PRO } from "@/lib/plans";
import { ProcessingRing, ProcessingTooltip } from "@/components/processing-indicator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

export function UserMenu() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />;
  }

  if (!session) {
    return (
      <Button variant="outline" size="sm" onClick={() => signIn("github")}>
        <LogIn className="mr-2 h-4 w-4" />
        Sign in
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <ProcessingTooltip>
        <DropdownMenuTrigger asChild>
          <button className="relative cursor-pointer rounded-full outline-none focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2">
            <ProcessingRing />
            {session.user.image ? (
              <img
                src={session.user.image}
                alt={session.user.username ?? "User avatar"}
                className="h-8 w-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-full">
                <User className="h-4 w-4" />
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
      </ProcessingTooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-medium">{session.user.username || session.user.name}</span>
          {session.user.plan === PLAN_PRO ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
              <Star className="h-3 w-3 fill-amber-500" />
              Pro
            </span>
          ) : (
            <span className="text-muted-foreground text-xs capitalize">{session.user.plan} plan</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/my-tilesets" className="cursor-pointer">
            <Map className="mr-2 h-4 w-4" />
            My Tilesets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing" className="cursor-pointer">
            <CreditCard className="mr-2 h-4 w-4" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
