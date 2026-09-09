"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => registration.update())
        .catch((err) => {
          console.error("[sw] Registration failed:", err);
        });
    }
  }, []);

  return null;
}
