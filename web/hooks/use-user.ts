"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { getCurrentUser } from "@/lib/api";

export function useCurrentUser() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["user"],
    queryFn: () => getCurrentUser(session!.accessToken!),
    enabled: !!session?.accessToken,
  });
}
