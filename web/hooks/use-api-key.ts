"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiKey, getApiKeys, revokeApiKeyById } from "@/lib/api";

export function useApiKeys() {
  const { data: session } = useSession();
  return useQuery({ queryKey: ["api-keys", session?.user?.id], queryFn: () => getApiKeys(session!.accessToken!), enabled: !!session?.accessToken });
}

export function useCreateApiKey() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => createApiKey(session!.accessToken!), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys", session?.user?.id] }) });
}

export function useRevokeApiKey() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (keyId: string) => revokeApiKeyById(session!.accessToken!, keyId), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys", session?.user?.id] }) });
}
