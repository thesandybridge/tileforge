"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  API_URL,
  getTileSet,
  listTileSets,
  updateTileSet,
  deleteTileSet,
  type TileSet,
  type UpdateTileSetInput,
} from "@/lib/api";

export function useTilesets() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["tilesets"],
    queryFn: () => listTileSets(undefined, session?.accessToken),
    enabled: !!session?.accessToken,
  });
}

export function useTileset(slug: string) {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["tileset", slug],
    queryFn: () => getTileSet(slug, session?.accessToken),
    enabled: !!slug,
  });
}

export function useUpdateTileset(slug: string) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTileSetInput) =>
      updateTileSet(slug, input, session?.accessToken),
    onSuccess: (updated) => {
      queryClient.setQueryData<TileSet>(["tileset", slug], updated);
      queryClient.invalidateQueries({ queryKey: ["tilesets"] });
    },
  });
}

export function useDeleteTileset() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteTileSet(slug, session?.accessToken),
    onSuccess: (_data, slug) => {
      queryClient.setQueryData<TileSet[]>(["tilesets"], (old) =>
        old?.filter((ts) => ts.slug !== slug),
      );
      queryClient.invalidateQueries({ queryKey: ["tileset", slug] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
}

export function useTilesetPreview(slug: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${API_URL}/api/tiles/${encodeURIComponent(slug)}/download`,
      );
      if (!res.ok) throw new Error("Download failed");
      return res.blob();
    },
  });
}
