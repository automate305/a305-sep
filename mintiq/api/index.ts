import { createApp } from "../server/app.ts";

/** Vercel serverless entry. vercel.json rewrites /api/* here; the SPA is served from dist/. */
const app = createApp();
export default app;
