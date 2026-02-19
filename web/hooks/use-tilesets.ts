"use client";

import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  API_URL,
  getTileSet,
  listTileSets,
  updateTileSet,
  deleteTileSet,
  getPmtilesUrl,
  type TileSet,
  type UpdateTileSetInput,
} from "@/lib/api";

const PER_PAGE = 20;

export function useTilesets() {
  const { data: session } = useSession();
  return useInfiniteQuery({
    queryKey: ["tilesets"],
    queryFn: ({ pageParam }) =>
      listTileSets(undefined, session?.accessToken, { page: pageParam, perPage: PER_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === PER_PAGE ? lastPageParam + 1 : undefined,
    enabled: !!session?.accessToken,
  });
}

export function usePublicTilesets() {
  return useInfiniteQuery({
    queryKey: ["public-tilesets"],
    queryFn: ({ pageParam }) =>
      listTileSets(undefined, undefined, { page: pageParam, perPage: PER_PAGE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === PER_PAGE ? lastPageParam + 1 : undefined,
    staleTime: 5 * 60 * 1000,
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
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update tileset");
    },
  });
}

export function useDeleteTileset() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteTileSet(slug, session?.accessToken),
    onSuccess: (_data, slug) => {
      queryClient.invalidateQueries({ queryKey: ["tilesets"] });
      queryClient.invalidateQueries({ queryKey: ["tileset", slug] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
      toast.success("Tileset deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete tileset");
    },
  });
}

export function useTilesetPreview(slug: string) {
  const { data: session } = useSession();
  return useMutation({
    mutationFn: async () => {
      const headers: Record<string, string> = {};
      if (session?.accessToken) headers["authorization"] = `Bearer ${session.accessToken}`;
      const res = await fetch(
        `${API_URL}/api/tiles/${encodeURIComponent(slug)}/download`,
        { headers },
      );
      if (!res.ok) throw new Error("Download failed");
      return res.blob();
    },
  });
}

export function usePmtilesUrl(slug: string) {
  const { data: session } = useSession();
  return useMutation({
    mutationFn: () => getPmtilesUrl(slug, session?.accessToken),
  });
}
