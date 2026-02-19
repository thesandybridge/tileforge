"use client";

import { useMutation } from "@tanstack/react-query";
import { deactivateAccount } from "@/lib/api";

export function useDeactivate() {
  return useMutation({
    mutationFn: deactivateAccount,
  });
}
