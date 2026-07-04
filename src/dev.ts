// Local development server (not used on Vercel — Vercel imports src/index.ts directly).
// Run with: npm run dev
import { serve } from "@hono/node-server";
import app from "./index.js";

const port = Number(process.env.PORT ?? 3000);
console.log(`Telebirr Driver backend running locally on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
