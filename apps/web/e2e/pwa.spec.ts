/**
 * PWA E2E (production build, real Chromium):
 *  - /manifest.webmanifest is served with installability fields + icons
 *  - the service worker registers and takes control
 *  - icon assets resolve (200)
 *  - the app shell survives going offline (navigate to a cached route)
 */
import { test, expect } from "@playwright/test";

test.describe("PWA", () => {
  test("manifest + service worker + offline shell", async ({ page, context, baseURL }) => {
    // First visit: cache the shell.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const manifest = await fetch(`${baseURL}/manifest.webmanifest`).then((r) => r.json());
    expect(manifest.name).toContain("Z-float");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);

    for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
      const res = await fetch(`${baseURL}${icon}`);
      expect(res.status, icon).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    }

    // The SW must register (production build registers /sw.js).
    await expect
      .poll(async () => {
      const reg = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return null;
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.active?.state ?? null;
      });
        return reg;
      }, { timeout: 15_000 })
      .toBe("activated");

    // A controlled navigation caches the shell through the SW.
    await page.goto("/login");
    await expect(page.getByLabel("Work email")).toBeVisible();

    // Now go offline: the cached shell must still render.
    await context.setOffline(true);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Z-float", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await context.setOffline(false);
  });
});
