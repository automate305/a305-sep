import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { createApp } from "./server/app.js";

/** Local dev + self-hosted runner. On Vercel, api/index.ts is the entry point instead. */
async function main() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const dist = path.join(process.cwd(), "dist");
  const hasBuild = fs.existsSync(path.join(dist, "index.html"));

  if (process.env.NODE_ENV === "production" && hasBuild) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`MintIQ running on http://localhost:${PORT}`));
}

main();
