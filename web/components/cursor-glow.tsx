"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || resolvedTheme !== "dark") return;

    const el = ref.current;
    if (!el) return;

    const mq = window.matchMedia("(min-width: 900px)");
    if (!mq.matches) return;

    function onMove(e: MouseEvent) {
      if (!el) return;
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
      el.style.opacity = "1";
    }

    function onLeave() {
      if (!el) return;
      el.style.opacity = "0";
    }

    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [mounted, resolvedTheme]);

  // Don't render anything until mounted (avoids hydration mismatch)
  if (!mounted || resolvedTheme !== "dark") return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed z-50 hidden min-[900px]:block"
      style={{
        width: 400,
        height: 400,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(215,153,33,0.04) 0%, transparent 70%)",
        transform: "translate(-50%, -50%)",
        opacity: 0,
        transition: "opacity 0.3s ease",
      }}
    />
  );
}
