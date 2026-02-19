"use client";

import { useEffect, useRef } from "react";

const OVERFLOW = 200;

export function TileParticles({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Send active state to worker
  useEffect(() => {
    workerRef.current?.postMessage({ type: "active", value: active });
  }, [active]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    const container = containerRef.current;
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;

    // Create canvas imperatively so each mount gets a fresh transferable element
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = `${-OVERFLOW}px`;
    canvas.style.left = `${-OVERFLOW}px`;
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "0";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("role", "presentation");
    container.appendChild(canvas);

    if (typeof canvas.transferControlToOffscreen !== "function") {
      container.removeChild(canvas);
      return;
    }

    const offscreen = canvas.transferControlToOffscreen();
    const worker = new Worker("/particles.worker.js");
    workerRef.current = worker;

    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cardW = rect.width;
    const cardH = rect.height;

    canvas.style.width = `${cardW + OVERFLOW * 2}px`;
    canvas.style.height = `${cardH + OVERFLOW * 2}px`;

    worker.postMessage(
      { type: "init", canvas: offscreen, dpr, cardW, cardH, overflow: OVERFLOW },
      [offscreen],
    );

    worker.postMessage({ type: "active", value: active });

    // Pause/resume on runtime motion preference change
    const onMotionChange = (e: MediaQueryListEvent) => {
      worker.postMessage({ type: "active", value: active && !e.matches });
    };
    mq.addEventListener("change", onMotionChange);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      canvas.style.width = `${width + OVERFLOW * 2}px`;
      canvas.style.height = `${height + OVERFLOW * 2}px`;
      worker.postMessage({
        type: "resize",
        dpr: window.devicePixelRatio || 1,
        cardW: width,
        cardH: height,
      });
    });
    ro.observe(parent);

    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMotionChange);
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="pointer-events-none absolute inset-0" aria-hidden />;
}
