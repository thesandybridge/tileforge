"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Upload,
  Image,
  Settings,
  CreditCard,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Home,
  Grid3X3,
  FileText,
  GitCompare,
  DollarSign,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: session } = useSession();

  // Keyboard shortcut: Cmd+K or Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => router.push("/"))}>
              <Home className="mr-2 h-4 w-4" />
              Home
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/gallery"))}>
              <Grid3X3 className="mr-2 h-4 w-4" />
              Gallery
            </CommandItem>
            {session?.user && (
              <CommandItem onSelect={() => runCommand(() => router.push("/my-tilesets"))}>
                <Image className="mr-2 h-4 w-4" />
                My Tilesets
              </CommandItem>
            )}
            <CommandItem onSelect={() => runCommand(() => router.push("/compare"))}>
              <GitCompare className="mr-2 h-4 w-4" />
              Compare Tilesets
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/changelog"))}>
              <FileText className="mr-2 h-4 w-4" />
              Changelog
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/pricing"))}>
              <DollarSign className="mr-2 h-4 w-4" />
              Pricing
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => runCommand(() => {
              router.push("/");
              // Focus the file input after navigation
              setTimeout(() => {
                const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                input?.click();
              }, 100);
            })}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Image
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Theme">
            <CommandItem onSelect={() => runCommand(() => setTheme("light"))}>
              <Sun className="mr-2 h-4 w-4" />
              Light Mode
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme("dark"))}>
              <Moon className="mr-2 h-4 w-4" />
              Dark Mode
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme("system"))}>
              <Monitor className="mr-2 h-4 w-4" />
              System Theme
            </CommandItem>
          </CommandGroup>

          {session?.user && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Account">
                <CommandItem onSelect={() => runCommand(() => router.push("/settings"))}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => router.push("/billing"))}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Billing
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => signOut())}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
