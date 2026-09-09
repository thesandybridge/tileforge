"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { cancelJob, listJobs, retryJob } from "@/lib/api";

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

export function useJobActions() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["jobs", session?.user?.id] });
  return {
    cancel: useMutation({
      mutationFn: (jobId: string) => cancelJob(jobId, session!.accessToken!),
      onSuccess: refresh,
      onError: (error: Error) => toast.error(error.message),
    }),
    retry: useMutation({
      mutationFn: (jobId: string) => retryJob(jobId, session!.accessToken!),
      onSuccess: refresh,
      onError: (error: Error) => toast.error(error.message),
    }),
  };
}
