/**
 * Admin portal authentication helpers.
 * Uses HMAC-SHA256 signed tokens stored in an HttpOnly cookie.
 */
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return process.env.ADMIN_PASSWORD || "insecure-default-change-immediately";
}

/** Create a signed session token (base64url). */
export function signSession(username: string): string {
  const ts = Date.now().toString();
  const payload = `${username}:${ts}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

/** Verify a session token. Returns true if valid and not expired (24 h). */
export function verifySession(token: string): boolean {
  try {
    const raw = Buffer.from(token, "base64").toString("utf-8");
    const lastColon = raw.lastIndexOf(":");
    if (lastColon < 0) return false;

    const payload = raw.slice(0, lastColon);
    const sig     = raw.slice(lastColon + 1);

    // Check expiry — timestamp is the second segment
    const parts = payload.split(":");
    if (parts.length < 2) return false;
    const ts = parseInt(parts[parts.length - 1], 10);
    if (isNaN(ts) || Date.now() - ts > 86_400_000) return false; // 24 h

    const expected = createHmac("sha256", secret()).update(payload).digest("hex");
    const aBuf = Buffer.from(sig,      "hex");
    const bBuf = Buffer.from(expected, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

/** Parse the admin_tok cookie value from a Cookie header string. */
export function parseAdminCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/\badmin_tok=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Constant-time credential check. */
export function checkCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPass = process.env.ADMIN_PASSWORD || "change-me";

  // Pad to same length before comparing so timingSafeEqual won't throw
  const maxU = Math.max(username.length, expectedUser.length);
  const maxP = Math.max(password.length, expectedPass.length);

  const uA = Buffer.alloc(maxU); Buffer.from(username).copy(uA);
  const uB = Buffer.alloc(maxU); Buffer.from(expectedUser).copy(uB);
  const pA = Buffer.alloc(maxP); Buffer.from(password).copy(pA);
  const pB = Buffer.alloc(maxP); Buffer.from(expectedPass).copy(pB);

  const uOk = timingSafeEqual(uA, uB) && username.length === expectedUser.length;
  const pOk = timingSafeEqual(pA, pB) && password.length === expectedPass.length;
  return uOk && pOk;
}

export const COOKIE_NAME = "admin_tok";
export const COOKIE_OPTS = "Path=/admin; HttpOnly; SameSite=Lax; Max-Age=86400";
export const COOKIE_CLEAR = `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`;
