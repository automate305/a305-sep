import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0b0810",
    display: "standalone",
    icons: [{ sizes: "512x512", src: "/icon", type: "image/png" }],
    name: "OUTBOX",
    short_name: "OUTBOX",
    start_url: "/",
    theme_color: "#8c3fe1",
  };
}
