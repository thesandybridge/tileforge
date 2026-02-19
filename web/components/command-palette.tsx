"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  CommandLoading,
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
  Map,
  Loader2,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { searchTileSets, type TileSet } from "@/lib/api";

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

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TileSet[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: session } = useSession();
  const abortControllerRef = useRef<AbortController | null>(null);

  const debouncedSearch = useDebounce(search, 300);

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

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSearchResults([]);
    }
  }, [open]);

  // Debounced search for tilesets
  useEffect(() => {
    if (debouncedSearch.length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Abort previous request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const doSearch = async () => {
      setIsSearching(true);
      try {
        const results = await searchTileSets(debouncedSearch, session?.accessToken);
        setSearchResults(results);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Search failed:", err);
        }
      } finally {
        setIsSearching(false);
      }
    };

    doSearch();
  }, [debouncedSearch, session?.accessToken]);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={debouncedSearch.length < 3}>
        <CommandInput
          placeholder="Type a command or search tilesets..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>
            {search.length > 0 && search.length < 3
              ? "Type at least 3 characters to search tilesets..."
              : "No results found."}
          </CommandEmpty>

          {isSearching && (
            <CommandLoading>
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching tilesets...
              </div>
            </CommandLoading>
          )}

          {searchResults.length > 0 && (
            <>
              <CommandGroup heading="Tilesets">
                {searchResults.map((tileset) => (
                  <CommandItem
                    key={tileset.id}
                    value={`tileset-${tileset.slug}`}
                    onSelect={() => runCommand(() => router.push(`/tilesets/${tileset.slug}`))}
                  >
                    <Map className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span>{tileset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {tileset.tile_count} tiles · z{tileset.min_zoom}-{tileset.max_zoom}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

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
