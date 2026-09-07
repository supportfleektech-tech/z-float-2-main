import type { MetadataRoute } from "next";

/** Web app manifest — installability (name, icons 192+512, start_url, display). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Z-float — Business payments, controlled from one place",
    short_name: "Z-float",
    description:
      "Kenya-first business payment operations: disbursements, payroll, bills, bulk payments, approvals.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#0F5BFF",
    lang: "en",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
