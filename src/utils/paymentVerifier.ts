// utils/paymentVerifier.ts
import { query } from "../db/client.js";
import { SmsMessageRow } from "../types/index.js";

/**
 * Extracts pure 10-character Telebirr Transaction ID using your exact regular expression string
 */
export const extractTelebirrTxId = (rawText: string): string | null => {
    const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawulgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;
    const match = rawText.match(telebirrRegex);
    return match ? match[1] : null;
};

/**
 * Checks for a pending database entry containing the transaction code and exact subscription price string matching
 */
export const findMatchingSms = async (transactionId: string, amount: number): Promise<SmsMessageRow | null> => {
    const formattedAmount: string = amount.toFixed(2);
    
    const sql = `
        SELECT id, message, status, processed_by, processed_at, created_at 
        FROM sms_messages 
        WHERE status = 'pending' 
          AND message ILIKE $1 
          AND message ILIKE $2
        LIMIT 1
    `;
    
    const rows = await query<SmsMessageRow>(sql, [`%${transactionId}%`, `%${formattedAmount}%`]);
    return rows.length > 0 ? rows[0] : null;
};