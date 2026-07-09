// routes/subscriptionRoutes.ts
import { Hono } from "hono";
import { query, getPool } from "../db/client.js";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { paymentSchema, phoneSchema } from "../utils/validators.js";
import { extractTelebirrTxId, findMatchingSms } from "../utils/paymentVerifier.js";
import type { PoolClient } from "pg";

const subscription = new Hono<AuthEnv>();

// 1. GET /api/subscription/check/:phone — public, used by the app on launch/offline-sync
subscription.get("/subscription/check/:phone", async (c) => {
  const phone = c.req.param("phone");
  const phoneCheck = phoneSchema.safeParse(phone);
  if (!phoneCheck.success) {
    return c.json({ error: "Invalid phone number" }, 400);
  }

  const rows = await query<{ status: string; end_date: string; driver_id: number }>(
    `SELECT s.status, s.end_date, s.driver_id
     FROM subscriptions s
     JOIN drivers d ON s.driver_id = d.id
     WHERE d.phone = $1
     ORDER BY s.end_date DESC
     LIMIT 1`,
    [phone]
  );

  if (rows.length === 0) {
    return c.json({ paid: false, expires: null, status: "not_found" });
  }

  const sub = rows[0];
  const now = new Date();
  const endDate = new Date(sub.end_date);
  // 3-day grace period after the recorded end_date before we report "unpaid"
  const graceEnd = new Date(endDate);
  graceEnd.setDate(graceEnd.getDate() + 3);

  const paid = now <= graceEnd;

  return c.json({
    paid,
    expires: sub.end_date,
    status: sub.status,
    inGracePeriod: now > endDate && now <= graceEnd,
  });
});

// 2. POST /api/subscription/payment — Existing Stripe (or other payment) endpoint
subscription.post("/subscription/payment", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }
  const { phone, transaction_id, amount, status } = parsed.data;

  const driverRows = await query<{ id: number }>("SELECT id FROM drivers WHERE phone = $1", [phone]);
  if (driverRows.length === 0) {
    return c.json({ error: "Driver not found" }, 404);
  }
  const driverId = driverRows[0].id;

  const dupe = await query("SELECT id FROM subscription_payments WHERE transaction_id = $1", [transaction_id]);
  if (dupe.length > 0) {
    return c.json({ error: "This transaction has already been recorded" }, 409);
  }

  const currentSub = await query<{ end_date: string }>(
    `SELECT end_date FROM subscriptions WHERE driver_id = $1 ORDER BY end_date DESC LIMIT 1`,
    [driverId]
  );
  const now = new Date();
  const base = currentSub.length > 0 && new Date(currentSub[0].end_date) > now
    ? new Date(currentSub[0].end_date)
    : now;
  const newEnd = new Date(base);
  newEnd.setDate(newEnd.getDate() + 30);

  const newSub = await query<{ id: number }>(
    `INSERT INTO subscriptions (driver_id, start_date, end_date, amount, payment_method, transaction_id, status)
     VALUES ($1, NOW(), $2, $3, 'stripe', $4, 'active') RETURNING id`,
    [driverId, newEnd.toISOString(), amount, transaction_id]
  );

  await query(
    `INSERT INTO subscription_payments (driver_id, subscription_id, transaction_id, amount, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [driverId, newSub[0].id, transaction_id, amount, status]
  );

  return c.json({ success: true, paid: true, expires: newEnd.toISOString() }, 201);
});

// 3. NEW: POST /api/subscription/verify-telebirr — public endpoint used by drivers claiming pasted SMS text
subscription.post("/subscription/verify-telebirr", async (c) => {
  let body: { driverId: number; amount: number; smsText: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: "Invalid JSON payload." }, 400);
  }

  const { driverId, amount, smsText } = body;
  if (!driverId || !amount || !smsText) {
    return c.json({ success: false, message: "Missing required fields." }, 400);
  }

  const parsedAmount = parseFloat(amount as any);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return c.json({ success: false, message: "Invalid payment amount." }, 400);
  }

  // A. Extract Telebirr reference from text input
  const transactionId = extractTelebirrTxId(smsText);
  if (!transactionId) {
    return c.json({ success: false, message: "No valid Telebirr transaction code found in text." }, 422);
  }

  // B. Locate unspent gateway notification SMS record
  const matchingSms = await findMatchingSms(transactionId, parsedAmount);
  if (!matchingSms) {
    return c.json({ success: false, message: "No matching or unspent payment notification found." }, 404);
  }

  const pool = getPool();
  const client: PoolClient = await pool.connect();

  try {
    await client.query("BEGIN");

    // C. Concurrency Row Lock: Stop duplicate processing requests mid-flight
    const smsLockSql = 'SELECT status FROM sms_messages WHERE id = $1 FOR UPDATE';
    const smsLockRes = await client.query<{ status: string }>(smsLockSql, [matchingSms.id]);
    
    if (smsLockRes.rows.length === 0 || smsLockRes.rows[0].status !== 'pending') {
      await client.query("ROLLBACK");
      return c.json({ success: false, message: "This transaction has already been claimed." }, 409);
    }

    // D. Fetch and lock latest existing subscription state
    const subLockSql = `
        SELECT id, end_date, status FROM subscriptions 
        WHERE driver_id = $1 
        ORDER BY end_date DESC LIMIT 1 FOR UPDATE
    `;
    const subLockRes = await client.query<{ id: number; end_date: string; status: string }>(subLockSql, [driverId]);

    let startDate: Date = new Date();
    let currentEndDate: Date | null = null;
    let subscriptionId: number | null = null;

    if (subLockRes.rows.length > 0) {
      subscriptionId = subLockRes.rows[0].id;
      currentEndDate = new Date(subLockRes.rows[0].end_date);
      
      // Extend future date if current plan is active; otherwise start renewal from NOW
      if (currentEndDate > new Date()) {
        startDate = currentEndDate;
      }
    }

    const newEndDate = new Date(startDate.getTime());
    newEndDate.setDate(newEndDate.getDate() + 30);

    if (subscriptionId !== null) {
      // Update running timeline record 
      const updateSubSql = `
          UPDATE subscriptions 
          SET end_date = $1, status = 'active', transaction_id = $2, payment_method = 'Telebirr' 
          WHERE id = $3
      `;
      await client.query(updateSubSql, [newEndDate.toISOString(), transactionId, subscriptionId]);
    } else {
      // Create initial timeline tier record row
      const insertSubSql = `
          INSERT INTO subscriptions (driver_id, start_date, end_date, amount, payment_method, transaction_id, status)
          VALUES ($1, NOW(), $2, $3, 'Telebirr', $4, 'active') RETURNING id
      `;
      const newSubRes = await client.query<{ id: number }>(insertSubSql, [driverId, newEndDate.toISOString(), parsedAmount, transactionId]);
      subscriptionId = newSubRes.rows[0].id;
    }

    // E. Anti-fraud safety double check on the historical invoices log ledger
    const paymentCheckSql = 'SELECT id FROM subscription_payments WHERE transaction_id = $1';
    const paymentCheckRes = await client.query(paymentCheckSql, [transactionId]);
    if (paymentCheckRes.rows.length > 0) {
      await client.query("ROLLBACK");
      return c.json({ success: false, message: "Duplicate payment record detected." }, 409);
    }

    // Insert permanent completed transaction log invoice receipt
    const insertPaymentSql = `
        INSERT INTO subscription_payments (driver_id, subscription_id, transaction_id, amount, status)
        VALUES ($1, $2, $3, $4, 'completed')
    `;
    await client.query(insertPaymentSql, [driverId, subscriptionId, transactionId, parsedAmount]);

    // F. Mark incoming message spent to close transaction loop lifecycle
    const updateSmsSql = `
        UPDATE sms_messages 
        SET status = 'processed', processed_by = $1, processed_at = NOW() 
        WHERE id = $2
    `;
    await client.query(updateSmsSql, [driverId, matchingSms.id]);

    await client.query("COMMIT");

    return c.json({
      success: true,
      message: "Subscription payment verified and access extended successfully.",
      data: {
        subscriptionId,
        extendedUntil: newEndDate.toISOString(),
        transactionId
      }
    }, 200);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Critical Exception in Telebirr Hono Engine Transaction:", error);
    return c.json({ success: false, message: "Internal processing engine failure." }, 500);
  } finally {
    client.release();
  }
});

// 4. POST /api/subscription/create — JWT-protected, explicitly (re)initialize trial
subscription.post("/subscription/create", authMiddleware, async (c) => {
  const driver = c.get("driver");

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);

  const result = await query<{ id: number }>(
    `INSERT INTO subscriptions (driver_id, start_date, end_date, amount, status)
     VALUES ($1, NOW(), $2, 0, 'trial') RETURNING id`,
    [driver.driverId, trialEnd.toISOString()]
  );

  return c.json({ success: true, subscriptionId: result[0].id, expires: trialEnd.toISOString() }, 201);
});

export default subscription;