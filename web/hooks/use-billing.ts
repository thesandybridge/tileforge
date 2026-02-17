"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { PLAN_PRO } from "@/lib/plans";

async function createCheckout() {
  const res = await fetch("/api/stripe/checkout", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create checkout session");
  return res.json() as Promise<{ url: string }>;
}

async function createPortalSession() {
  const res = await fetch("/api/stripe/portal", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create portal session");
  return res.json() as Promise<{ url: string }>;
}

export function useCheckout() {
  return useMutation({
    mutationFn: createCheckout,
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
  });
}

export function usePortalSession() {
  return useMutation({
    mutationFn: createPortalSession,
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
  });
}

export function usePlanRefresh() {
  const { data: session, update } = useSession();
  const searchParams = useSearchParams();
  const waiting = searchParams.get("upgraded") === "true";
  const upgraded = waiting && session?.user?.plan === PLAN_PRO;

  useQuery({
    queryKey: ["plan-refresh"],
    queryFn: async () => {
      // Pass data to force a POST, triggering jwt callback with trigger="update"
      await update({ refreshPlan: true });
      return null;
    },
    enabled: waiting && !upgraded,
    refetchInterval: 2000,
  });

  const refreshing = waiting && !upgraded;

  return { upgraded, refreshing };
}
