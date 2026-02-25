"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { listLinkedAccounts, unlinkAccount, updateAvatar } from "@/lib/api";

export function useLinkedAccounts() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["linked-accounts"],
    queryFn: () => listLinkedAccounts(session!.accessToken!),
    enabled: !!session?.accessToken,
  });
}

export function useUnlinkAccount() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => unlinkAccount(provider, session!.accessToken!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
    },
  });
}

export function useUpdateAvatar() {
  const { data: session, update: updateSession } = useSession();
  return useMutation({
    mutationFn: (provider: string) => updateAvatar(provider, session!.accessToken!),
    onSuccess: () => updateSession(),
  });
}
