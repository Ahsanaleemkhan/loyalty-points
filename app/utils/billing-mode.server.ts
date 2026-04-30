/**
 * Billing mode utility — reads test/live flag from AdminSettings (DB).
 * Falls back to the BILLING_TEST_MODE env var if the DB row doesn't exist yet.
 */
import prisma from "../db.server";

let _cache: boolean | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30_000; // re-read DB at most every 30 s

export async function getBillingTestMode(): Promise<boolean> {
  const now = Date.now();
  if (_cache !== null && now - _cacheTime < CACHE_TTL_MS) return _cache;

  try {
    const settings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
    // If row exists use its value; otherwise fall back to env var default
    _cache = settings?.billingTestMode ?? (process.env.BILLING_TEST_MODE !== "false");
    _cacheTime = now;
    return _cache;
  } catch {
    return process.env.BILLING_TEST_MODE !== "false";
  }
}

/** Call this after toggling so the next request reads fresh from DB */
export function invalidateBillingModeCache() {
  _cache = null;
  _cacheTime = 0;
}
