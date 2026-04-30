/**
 * Token management for Shopify offline access tokens.
 *
 * Strategy (in order):
 *  1. AppSettings cache — fast path, skip DB session lookup
 *  2. Offline session — if token still valid, use it
 *  3. Refresh token   — if token expiring/expired and refresh token exists
 *  4. Auto-migration  — if no refresh token (non-expiring legacy token) OR refresh failed,
 *                       exchange the current token for an expiring one via Shopify's
 *                       token-exchange endpoint. This handles the case where Shopify has
 *                       deprecated non-expiring tokens and the merchant hasn't re-authed.
 *
 * Shopify docs:
 *  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 *  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens#migrating-from-non-expiring-to-expiring-tokens
 */
import prisma from "../db.server";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

async function saveToken(
  shop: string,
  sessionId: string,
  accessToken: string,
  expiresAt: Date,
  refreshToken?: string,
  refreshExpiresAt?: Date,
) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      accessToken,
      expires: expiresAt,
      ...(refreshToken        ? { refreshToken }                           : {}),
      ...(refreshExpiresAt   ? { refreshTokenExpires: refreshExpiresAt }  : {}),
    },
  });
  await prisma.appSettings
    .upsert({
      where:  { shop },
      update: { adminAccessToken: accessToken, adminTokenExpires: expiresAt },
      create: { shop, adminAccessToken: accessToken, adminTokenExpires: expiresAt },
    })
    .catch(() => {});
}

/** Try to refresh an expiring token using the stored refresh_token */
async function tryRefresh(
  shop: string,
  sessionId: string,
  refreshToken: string,
): Promise<{ accessToken: string; tokenType: string } | null> {
  const apiKey    = process.env.SHOPIFY_API_KEY!;
  const apiSecret = process.env.SHOPIFY_API_SECRET!;

  console.log(`[token] Attempting refresh for ${shop}`);
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     apiKey,
        client_secret: apiSecret,
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !data.access_token) {
      console.warn(`[token] Refresh failed (${res.status}) for ${shop}:`, text.slice(0, 200));
      return null;
    }

    const newToken: string       = data.access_token;
    const expiresIn: number      = data.expires_in ?? 3600;
    const newRefresh: string | undefined  = data.refresh_token;
    const refreshExpiresIn: number | undefined = data.refresh_token_expires_in;
    const expiresAt     = new Date(Date.now() + expiresIn * 1000);
    const refreshExpAt  = refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000) : undefined;

    await saveToken(shop, sessionId, newToken, expiresAt, newRefresh, refreshExpAt);
    console.log(`[token] ✓ Refreshed for ${shop}, expires ${expiresAt.toISOString()}`);
    return { accessToken: newToken, tokenType: "refreshed" };
  } catch (e: any) {
    console.error(`[token] Refresh exception for ${shop}:`, e?.message);
    return null;
  }
}

/**
 * Auto-migrate a non-expiring (legacy) token to an expiring token with refresh_token.
 * Uses Shopify's token-exchange grant — no merchant interaction needed.
 * The current accessToken is used as the subject_token.
 */
async function tryMigration(
  shop: string,
  sessionId: string,
  currentAccessToken: string,
): Promise<{ accessToken: string; tokenType: string } | null> {
  const apiKey    = process.env.SHOPIFY_API_KEY!;
  const apiSecret = process.env.SHOPIFY_API_SECRET!;

  console.log(`[token] Attempting auto-migration for ${shop}`);
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:             apiKey,
        client_secret:         apiSecret,
        grant_type:            "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token:         currentAccessToken,
        subject_token_type:    "urn:ietf:params:oauth:token-type:access_token",
        requested_token_type:  "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring:              "1",
      }).toString(),
    });

    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok || !data.access_token) {
      console.warn(`[token] Migration failed (${res.status}) for ${shop}:`, text.slice(0, 300));
      return null;
    }

    const newToken: string       = data.access_token;
    const expiresIn: number      = data.expires_in ?? 3600;
    const newRefresh: string | undefined  = data.refresh_token;
    const refreshExpiresIn: number | undefined = data.refresh_token_expires_in;
    const expiresAt    = new Date(Date.now() + expiresIn * 1000);
    const refreshExpAt = refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000) : undefined;

    await saveToken(shop, sessionId, newToken, expiresAt, newRefresh, refreshExpAt);
    console.log(`[token] ✓ Auto-migrated for ${shop}, expires ${expiresAt.toISOString()}, hasRefresh=${!!newRefresh}`);
    return { accessToken: newToken, tokenType: "migrated" };
  } catch (e: any) {
    console.error(`[token] Migration exception for ${shop}:`, e?.message);
    return null;
  }
}

/**
 * Returns a valid access token for the given shop.
 * Automatically refreshes or migrates the token as needed — no merchant interaction required.
 * Returns null only if no session exists at all (app not installed).
 */
export async function getValidAccessToken(shop: string): Promise<{
  accessToken: string;
  tokenType: string;
} | null> {
  // ── 1. Fast path: AppSettings cached token ────────────────────────────────
  const appSettings = await prisma.appSettings.findUnique({ where: { shop } });
  if (
    appSettings?.adminAccessToken &&
    appSettings.adminTokenExpires &&
    appSettings.adminTokenExpires.getTime() - Date.now() > REFRESH_BUFFER_MS
  ) {
    return { accessToken: appSettings.adminAccessToken, tokenType: "cached-admin" };
  }

  // ── 2. Load offline session ───────────────────────────────────────────────
  const session = await prisma.session.findFirst({
    where:   { shop, isOnline: false },
    orderBy: { id: "asc" },
  });

  if (!session?.accessToken) {
    console.warn(`[token] No offline session found for ${shop}`);
    return null;
  }

  // ── 3. Token still valid? Use it ──────────────────────────────────────────
  const isExpiring =
    !session.expires ||
    session.expires.getTime() - Date.now() < REFRESH_BUFFER_MS;

  if (!isExpiring) {
    // Cache into AppSettings
    await prisma.appSettings
      .upsert({
        where:  { shop },
        update: { adminAccessToken: session.accessToken, adminTokenExpires: session.expires },
        create: { shop, adminAccessToken: session.accessToken, adminTokenExpires: session.expires },
      })
      .catch(() => {});
    return { accessToken: session.accessToken, tokenType: "offline-session" };
  }

  // ── 4. Token expiring/expired — try refresh first ─────────────────────────
  if (session.refreshToken) {
    const refreshed = await tryRefresh(shop, session.id, session.refreshToken);
    if (refreshed) return refreshed;
    // Refresh failed (refresh token may also be expired) — fall through to migration
    console.warn(`[token] Refresh failed for ${shop} — attempting migration fallback`);
  } else {
    console.warn(`[token] No refresh token for ${shop} — token is non-expiring legacy, attempting migration`);
  }

  // ── 5. Auto-migrate: exchange current token for expiring token ────────────
  // Works for both:
  //   a) Non-expiring (legacy shpat_) tokens that have no refresh token
  //   b) Tokens whose refresh token has expired (uses last known access token)
  const migrated = await tryMigration(shop, session.id, session.accessToken);
  if (migrated) return migrated;

  // ── 6. All strategies failed ──────────────────────────────────────────────
  // Return the current token as absolute last resort — it will likely 403,
  // but at least we tried everything. The calling code surfaces a clear error.
  console.error(`[token] ⚠️  All token strategies failed for ${shop} — returning stale token`);
  return { accessToken: session.accessToken, tokenType: "all-strategies-failed" };
}
