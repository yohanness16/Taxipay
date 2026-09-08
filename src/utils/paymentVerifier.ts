// utils/paymentVerifier.ts
import { query } from "../db/client.js";
import { SmsMessageRow } from "../types/index.js";

/**
 * Extracts pure 10-character Telebirr Transaction ID from direct code input or raw SMS text in multiple languages.
 */
export const extractTelebirrTxId = (rawText: string): string | null => {
  if (!rawText) return null;
  const trimmed = rawText.trim().replace(/['"“”]/g, "");

  // 1. Direct standalone 10-character alphanumeric transaction ID (e.g., "DB81DF7ABC" or "db81df7abc")
  if (/^[A-Za-z0-9]{10}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // 2. Multi-lingual Telebirr SMS patterns (English, Amharic, Afaan Oromoo, Tigrinya, Somali, and short abbreviations)
  const telebirrRegex = /(?:transaction\s*(?:number|no\.?|id|code)?\s*is|የሂሳብ\s*እንቅስቃሴ\s*ቁጥርዎ|የግብይት\s*(?:ቁጥር|መለያ)|Lakkoofsi\s*sochii\s*maallaqaa\s*keessan|ቁፅሪ\s*ሒሳብ\s*ዝተንቀሳቀሰ|lambarka\s*hawulgalkaaguna\s*waa|(?:txn|transaction)\s*(?:id|no|#)?\s*[:=]?)\s*([A-Za-z0-9]{10})/i;
  const match = rawText.match(telebirrRegex);
  if (match) {
    return match[1].toUpperCase();
  }

  // 3. Fallback: Search for any standalone 10-character alphanumeric token in text
  const standaloneMatch = rawText.match(/\b([A-Za-z0-9]{10})\b/);
  return standaloneMatch ? standaloneMatch[1].toUpperCase() : null;
};

/**
 * Checks for a pending database entry containing the transaction code and flexible subscription price representation.
 */
export const findMatchingSms = async (transactionId: string, amount: number): Promise<SmsMessageRow | null> => {
  // Generate valid amount string representations to match Telebirr SMS variants (e.g., "100.00", "100", "1,000.00")
  const withDecimals = amount.toFixed(2);
  const withoutDecimals = Number.isInteger(amount) ? amount.toString() : null;
  const withCommas = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const withCommasNoDec = Number.isInteger(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: 0 }) : null;

  const amountVariants = Array.from(
    new Set([withDecimals, withoutDecimals, withCommas, withCommasNoDec].filter(Boolean) as string[])
  );

  const amountConditions = amountVariants
    .map((_, idx) => `message ILIKE $${idx + 2}`)
    .join(" OR ");

  const sql = `
      SELECT id, message, status, processed_by, processed_at, created_at 
      FROM sms_messages 
      WHERE status = 'pending' 
        AND message ILIKE $1 
        AND (${amountConditions})
      LIMIT 1
  `;

  const params = [`%${transactionId}%`, ...amountVariants.map((v) => `%${v}%`)];
  const rows = await query<SmsMessageRow>(sql, params);
  return rows.length > 0 ? rows[0] : null;
};