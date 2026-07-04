import { Hono } from "hono";
import { query } from "../db/client.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { registerSchema, loginSchema } from "../utils/validators.js";
import { signToken } from "../middleware/auth.js";

const register = new Hono();

// POST /api/register — create a new driver + 7-day trial subscription
register.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }
  const { phone, name, vehicle_number, password } = parsed.data;

  const existing = await query("SELECT id FROM drivers WHERE phone = $1", [phone]);
  if (existing.length > 0) {
    return c.json({ error: "A driver with this phone number already exists" }, 409);
  }

  const passwordHash = await hashPassword(password);

  const inserted = await query<{ id: number }>(
    `INSERT INTO drivers (phone, name, vehicle_number, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [phone, name, vehicle_number ?? null, passwordHash]
  );
  const driverId = inserted[0].id;

  // Start a 7-day free trial
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);

  await query(
    `INSERT INTO subscriptions (driver_id, start_date, end_date, amount, status)
     VALUES ($1, NOW(), $2, 0, 'trial')`,
    [driverId, trialEnd.toISOString()]
  );

  const token = signToken({ driverId, phone });

  return c.json({
    success: true,
    driverId,
    token,
    trialExpires: trialEnd.toISOString(),
  }, 201);
});

// POST /api/login
register.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }
  const { phone, password } = parsed.data;

  const rows = await query<{ id: number; password_hash: string; name: string }>(
    "SELECT id, password_hash, name FROM drivers WHERE phone = $1",
    [phone]
  );
  if (rows.length === 0) {
    return c.json({ error: "Invalid phone number or password" }, 401);
  }

  const valid = await verifyPassword(password, rows[0].password_hash);
  if (!valid) {
    return c.json({ error: "Invalid phone number or password" }, 401);
  }

  const token = signToken({ driverId: rows[0].id, phone });
  return c.json({ success: true, token, driverId: rows[0].id, name: rows[0].name });
});

export default register;
