import { redisConnection } from "./queue";
import logger from "../utils/logger";
import crypto from "crypto";

const IDEMPOTENCY_TTL = 86400; // 24 hours in seconds

/**
 * Check if an idempotency key has already been processed.
 * Returns the cached result if found, null otherwise.
 */
export async function checkIdempotency(
  key: string
): Promise<string | null> {
  try {
    const cached = await redisConnection.get(`idempotency:${key}`);
    return cached;
  } catch (err) {
    logger.error({ err, key }, "Failed to check idempotency key");
    return null;
  }
}

/**
 * Store the result for an idempotency key in Redis with a 24h TTL.
 */
export async function storeIdempotencyResult(
  key: string,
  result: object
): Promise<void> {
  try {
    const serialized = JSON.stringify(result);
    await redisConnection.setex(
      `idempotency:${key}`,
      IDEMPOTENCY_TTL,
      serialized
    );
  } catch (err) {
    logger.error({ err, key }, "Failed to store idempotency result");
  }
}

/**
 * Generate an idempotency key from a request body hash if
 * no explicit key is provided.
 */
export function generateIdempotencyKey(body: object): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  return hash.substring(0, 32);
}
