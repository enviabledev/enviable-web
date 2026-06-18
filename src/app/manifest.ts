import type { MetadataRoute } from "next";

/**
 * PWA manifest. This is an offline-capable app (see public/sw.js), so a proper
 * manifest + maskable icon makes it installable on warehouse / field devices
 * with the Enviable mark on the home screen.
 *
 * Icons are generated from logos/Tricycle logo icon.png (the standalone mark)
 * into public/icons. theme_color is the brand navy sampled from the logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Enviable Inventory & Operations",
    short_name: "Enviable I&O",
    description: "Enviable inventory and operations system",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#01022f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
