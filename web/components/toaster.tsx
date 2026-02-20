"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster() {
  const { mode } = useTheme();

  return (
    <SonnerToaster
      theme={mode}
      position="bottom-right"
      richColors
    />
  );
}
