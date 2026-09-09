"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { listJobs } from "@/lib/api";

export function useJobs() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  return useQuery({
    queryKey: ["jobs", session?.user?.id],
    queryFn: () => listJobs(token!),
    enabled: !!token,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "queued" || job.status === "processing")
        ? 3000
        : false,
  });
}
