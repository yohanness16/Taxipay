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

// These will now map perfectly to /api/health, /api/subscription/sms-webhook, etc.
app.get("/api/health", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));

app.route("/api", register);
app.route("/api", subscription);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
