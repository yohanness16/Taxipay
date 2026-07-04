import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "@hono/node-server/vercel";
import register from "./routes/register.js";
import subscription from "./routes/subscription.js";

const app = new Hono().basePath("/api");

app.use("/*", cors({
  origin: (origin) => {
    const allowed = process.env.ALLOWED_ORIGINS ?? "*";
    if (allowed === "*") return origin ?? "*";
    return allowed.split(",").includes(origin ?? "") ? origin : allowed.split(",")[0];
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

app.get("/health", (c) => c.json({ status: "ok", service: "telebirr-driver-backend" }));

app.route("/", register);
app.route("/", subscription);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;

// Vercel serverless entry point
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
