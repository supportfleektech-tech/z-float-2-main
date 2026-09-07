"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (production only — dev hot-reload fights the
 * SW cache). Localhost is a secure context, so this also works in the demo.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => {
        if (!cancelled) navigator.serviceWorker.ready.catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
