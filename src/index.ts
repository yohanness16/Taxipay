import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel"; // ⚡️ Use the native Vercel adapter
import register from "./routes/register.js";
import subscription from "./routes/subscription.js";

// ⚡️ Remove .basePath("/api") because Vercel/Hono handle routing context seamlessly via the handler
const app = new Hono();

app.use("/*", cors({
  origin: (origin) => {
    const allowed = process.env.ALLOWED_ORIGINS ?? "*";
    if (allowed === "*") return origin ?? "*";
    return allowed.split(",").includes(origin ?? "") ? origin : allowed.split(",")[0];
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

// Base health endpoints
app.get("/", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));
app.get("/health", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));
app.get("/api/health", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));

// Route under both root and /api prefixes
app.route("/", register);
app.route("/api", register);
app.route("/", subscription);
app.route("/api", subscription);

// Fallback in case Vercel rewrites directly to the file path
app.route("/src/index.ts", register);
app.route("/src/index.ts", subscription);
app.get("/src/index.ts/health", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));
app.get("/src/index.ts", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));

app.notFound((c) => c.json({
  error: "Not found",
  path: c.req.path,
  url: c.req.url,
  matchedPath: c.req.header("x-matched-path"),
  method: c.req.method,
}, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

// Intercept app.fetch to restore original URL if rewritten by Vercel
const originalFetch = app.fetch.bind(app);
const customFetch = (req: Request, env?: any, executionCtx?: any) => {
  try {
    const url = new URL(req.url);
    const pathParam = url.searchParams.get("path") || req.headers.get("x-matched-path");
    if (pathParam) {
      const cleanPath = pathParam.startsWith("/") ? pathParam : "/" + pathParam;
      url.pathname = cleanPath;
      url.searchParams.delete("path");
      const newReq = new Request(url.toString(), req);
      return originalFetch(newReq, env, executionCtx);
    }
  } catch {
    // ignore URL parsing error
  }
  return originalFetch(req, env, executionCtx);
};

app.fetch = customFetch as any;

export default app;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
