// controllers/subscriptionController.ts
import { Context } from "hono";
import { getPool } from "../db/client.js";
import { extractTelebirrTxId, findMatchingSms } from "../utils/paymentVerifier.js";
import { SubscriptionRow, SmsMessageRow } from "../types/index.js";
import { PoolClient } from "pg";

interface SubscriptionRequestBody {
    driverId: number;
    amount: number;
    smsText: string;
}

export const verifySubscriptionPayment = async (c: Context) => {
    let body: SubscriptionRequestBody;
    
    try {
        body = await c.req.json<SubscriptionRequestBody>();
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

    // 1. Check for valid Telebirr Reference Format
    const transactionId = extractTelebirrTxId(smsText);
    if (!transactionId) {
        return c.json({ success: false, message: "No valid Telebirr transaction code found in text." }, 422);
    }

    // 2. Locate unspent validation SMS
    const matchingSms = await findMatchingSms(transactionId, parsedAmount);
    if (!matchingSms) {
        return c.json({ success: false, message: "No matching or unspent payment notification found." }, 404);
    }

    const pool = getPool();
    const client: PoolClient = await pool.connect();

    try {
        await client.query("BEGIN");

        // 3. Concurrency Lock: Ensure this explicit SMS row hasn't been claimed simultaneously
        const smsLockSql = 'SELECT status FROM sms_messages WHERE id = $1 FOR UPDATE';
        const smsLockRes = await client.query<Pick<SmsMessageRow, 'status'>>(smsLockSql, [matchingSms.id]);
        
        if (smsLockRes.rows.length === 0 || smsLockRes.rows[0].status !== 'pending') {
            await client.query("ROLLBACK");
            return c.json({ success: false, message: "This transaction has already been claimed." }, 409);
        }

        // 4. Fetch and Row-Lock the driver's latest active or expired subscription profile
        const subLockSql = `
            SELECT id, end_date, status FROM subscriptions 
            WHERE driver_id = $1 
            ORDER BY end_date DESC LIMIT 1 FOR UPDATE
        `;
        const subLockRes = await client.query<Pick<SubscriptionRow, 'id' | 'end_date' | 'status'>>(subLockSql, [driverId]);

        let startDate: Date = new Date();
        let currentEndDate: Date | null = null;
        let subscriptionId: number | null = null;

        if (subLockRes.rows.length > 0) {
            subscriptionId = subLockRes.rows[0].id;
            currentEndDate = new Date(subLockRes.rows[0].end_date);
            
            // If active: append 30 days onto their future expiration. If expired: start from NOW.
            if (currentEndDate > new Date()) {
                startDate = currentEndDate;
            }
        }

       // -- Calculate new expiration timeline target (+30 days)
        const newEndDate: Date = new Date(startDate.getTime());
        newEndDate.setDate(newEndDate.getDate() + 30);

        if (subscriptionId !== null) {
            // Update current active subscription timeline block
            const updateSubSql = `
                UPDATE subscriptions 
                SET end_date = $1, status = 'active', transaction_id = $2, payment_method = 'Telebirr' 
                WHERE id = $3
            `;
            await client.query(updateSubSql, [newEndDate, transactionId, subscriptionId]);
        } else {
            // Generate a fresh subscription profile row if this is their initial purchase
            const insertSubSql = `
                INSERT INTO subscriptions (driver_id, start_date, end_date, amount, payment_method, transaction_id, status)
                VALUES ($1, $2, $3, $4, 'Telebirr', $5, 'active') RETURNING id
            `;
            const newSubRes = await client.query<{ id: number }>(insertSubSql, [driverId, startDate, newEndDate, parsedAmount, transactionId]);
            subscriptionId = newSubRes.rows[0].id;
        }

        // 5. Check for unique constraints inside transaction payments log table
        const paymentCheckSql = 'SELECT id FROM subscription_payments WHERE transaction_id = $1';
        const paymentCheckRes = await client.query(paymentCheckSql, [transactionId]);
        
        if (paymentCheckRes.rows.length > 0) {
            await client.query("ROLLBACK");
            return c.json({ success: false, message: "Duplicate payment record detected." }, 409);
        }

        // Log permanent ledger transaction receipt
        const insertPaymentSql = `
            INSERT INTO subscription_payments (driver_id, subscription_id, transaction_id, amount, status)
            VALUES ($1, $2, $3, $4, 'completed')
        `;
        await client.query(insertPaymentSql, [driverId, subscriptionId, transactionId, parsedAmount]);

        // 6. Close the SMS lifecycle by updating state to processed
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
                extendedUntil: newEndDate,
                transactionId
            }
        }, 200);

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Critical Exception inside SaaS Subscription Transaction Engine:", error);
        return c.json({ success: false, message: "Internal processing engine failure." }, 500);
    } finally {
        client.release();
    }
};