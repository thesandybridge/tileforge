"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { getApiKey, createApiKey, revokeApiKey, type ApiKey } from "@/lib/api";

export function useApiKey() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["api-key"],
    queryFn: () => getApiKey(session!.accessToken!),
    enabled: !!session?.accessToken,
  });
}

export function useCreateApiKey() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createApiKey(session!.accessToken!),
    onSuccess: (data) => {
      qc.setQueryData<ApiKey | null>(["api-key"], {
        id: data.id,
        key_prefix: data.key_prefix,
        created_at: data.created_at,
      });
    },
  });
}

export function useRevokeApiKey() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => revokeApiKey(session!.accessToken!),
    onSuccess: () => {
      qc.setQueryData<ApiKey | null>(["api-key"], null);
    },
  });
}
