/**
 * Token refresh utilities for expiring offline tokens.
 *
 * Shopify expiring offline tokens have a short lifespan. The refresh token
 * (valid for ~1 year) is used to get a new access token without user interaction.
 *
 * Shopify doc:
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 */
import prisma from "../db.server";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

/**
 * Returns a valid access token for the given shop.
 * Automatically refreshes using the stored refresh token if the current
 * access token is expired or about to expire.
 */
export async function getValidAccessToken(shop: string): Promise<{
  accessToken: string;
  tokenType: string;
  error?: string;
} | null> {
  const apiKey = process.env.SHOPIFY_API_KEY!;
  const apiSecret = process.env.SHOPIFY_API_SECRET!;

  // 1. Check AppSettings cached token — if valid and not expiring soon, use it
  const appSettings = await prisma.appSettings.findUnique({ where: { shop } });
  if (
    appSettings?.adminAccessToken &&
    appSettings.adminTokenExpires &&
    appSettings.adminTokenExpires.getTime() - Date.now() > REFRESH_BUFFER_MS
  ) {
    return { accessToken: appSettings.adminAccessToken, tokenType: "cached-admin" };
  }

  // 2. Load the offline session
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { id: "asc" },
  });

  if (!session) return null;

  const needsRefresh =
    !session.expires || // non-expiring (legacy) — try to refresh anyway
    session.expires.getTime() - Date.now() < REFRESH_BUFFER_MS;

  // 3. If token is still valid, use it
  if (!needsRefresh) {
    // Update AppSettings cache
    await prisma.appSettings
      .upsert({
        where: { shop },
        update: { adminAccessToken: session.accessToken, adminTokenExpires: session.expires },
        create: { shop, adminAccessToken: session.accessToken, adminTokenExpires: session.expires },
      })
      .catch(() => {});
    return { accessToken: session.accessToken, tokenType: "offline-session" };
  }

  // 4. Token expired / expiring soon — try refresh token
  if (!session.refreshToken) {
    // No refresh token stored — still return current token and hope for the best
    console.warn(`[token] No refresh token for ${shop}, using possibly-expired token`);
    return { accessToken: session.accessToken, tokenType: "offline-expired" };
  }

  console.log(`[token] Refreshing access token for ${shop}`);
  try {
    const body = new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });

    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }

    if (!res.ok || !data.access_token) {
      console.error(`[token] Refresh failed ${res.status}:`, text.slice(0, 300));
      // Fall back to current token
      return { accessToken: session.accessToken, tokenType: "offline-refresh-failed" };
    }

    const newToken: string = data.access_token;
    const expiresIn: number = data.expires_in ?? 3600;
    const newRefreshToken: string | undefined = data.refresh_token;
    const refreshExpiresIn: number | undefined = data.refresh_token_expires_in;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const refreshExpiresAt = refreshExpiresIn
      ? new Date(Date.now() + refreshExpiresIn * 1000)
      : undefined;

    // Persist the refreshed token
    await prisma.session.update({
      where: { id: session.id },
      data: {
        accessToken: newToken,
        expires: expiresAt,
        ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
        ...(refreshExpiresAt ? { refreshTokenExpires: refreshExpiresAt } : {}),
      },
    });

    await prisma.appSettings
      .upsert({
        where: { shop },
        update: { adminAccessToken: newToken, adminTokenExpires: expiresAt },
        create: { shop, adminAccessToken: newToken, adminTokenExpires: expiresAt },
      })
      .catch(() => {});

    console.log(`[token] ✓ Token refreshed for ${shop}, expires ${expiresAt.toISOString()}`);
    return { accessToken: newToken, tokenType: "refreshed" };
  } catch (e: any) {
    console.error(`[token] Refresh exception for ${shop}:`, e?.message);
    return { accessToken: session.accessToken, tokenType: "offline-refresh-error" };
  }
}
