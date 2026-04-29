/**
 * GET /api/migrate-token?shop=xxx.myshopify.com
 *
 * Official Shopify migration path for converting a non-expiring offline token
 * to an expiring offline token — no uninstall required.
 *
 * Shopify doc:
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/
 *   offline-access-tokens#migrating-from-non-expiring-to-expiring-tokens
 *
 * What it does:
 *   1. Reads the current offline session token for the shop
 *   2. Calls Shopify's token-exchange OAuth endpoint with grant_type=token-exchange
 *      + expiring=1 — Shopify returns a NEW expiring token and revokes the old one
 *   3. Persists the new token (+ refresh_token, expires_at) in the Session table
 *   4. Updates AppSettings.adminAccessToken with the new token
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return respond(400, { error: "Missing or invalid ?shop=xxx.myshopify.com" });
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!apiKey || !apiSecret) {
    return respond(500, { error: "SHOPIFY_API_KEY or SHOPIFY_API_SECRET not set in environment" });
  }

  // Find the current offline session
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { id: "asc" },
  });

  if (!session) {
    return respond(404, { error: "No offline session found for this shop. Complete the OAuth flow first." });
  }

  const currentToken = session.accessToken;

  // Check if it's already expiring
  if (session.expires) {
    return respond(200, {
      message: "Token is already expiring — no migration needed.",
      expires: session.expires,
      tokenPrefix: currentToken.slice(0, 12) + "…",
    });
  }

  console.log(`[migrate-token] Exchanging non-expiring token for ${shop}`);

  // Call Shopify's token exchange endpoint
  // POST /admin/oauth/access_token with grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  const body = new URLSearchParams({
    client_id: apiKey,
    client_secret: apiSecret,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: currentToken,
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });

  let exchangeResult: any;
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await res.text();
    console.log(`[migrate-token] Exchange response ${res.status}:`, text.slice(0, 500));

    try {
      exchangeResult = JSON.parse(text);
    } catch {
      return respond(500, { error: "Non-JSON response from Shopify", raw: text.slice(0, 300) });
    }

    if (!res.ok) {
      return respond(res.status, {
        error: "Shopify token exchange failed",
        details: exchangeResult,
      });
    }
  } catch (e: any) {
    return respond(500, { error: "Network error calling Shopify", message: e?.message });
  }

  // exchangeResult should contain:
  // { access_token, expires_in, refresh_token, refresh_token_expires_in, scope, token_type }
  const newToken: string = exchangeResult.access_token;
  const expiresIn: number = exchangeResult.expires_in; // seconds
  const refreshToken: string | undefined = exchangeResult.refresh_token;
  const refreshExpiresIn: number | undefined = exchangeResult.refresh_token_expires_in;
  const scope: string = exchangeResult.scope ?? session.scope ?? "";

  if (!newToken) {
    return respond(500, { error: "No access_token in Shopify response", response: exchangeResult });
  }

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year fallback

  const refreshExpiresAt = refreshExpiresIn
    ? new Date(Date.now() + refreshExpiresIn * 1000)
    : undefined;

  // Update the session in DB with the new expiring token
  try {
    await prisma.session.update({
      where: { id: session.id },
      data: {
        accessToken: newToken,
        expires: expiresAt,
        scope,
        ...(refreshToken ? { refreshToken } : {}),
        ...(refreshExpiresAt ? { refreshTokenExpires: refreshExpiresAt } : {}),
      },
    });

    // Also update AppSettings cached token
    await prisma.appSettings
      .upsert({
        where: { shop },
        update: { adminAccessToken: newToken, adminTokenExpires: expiresAt },
        create: { shop, adminAccessToken: newToken, adminTokenExpires: expiresAt },
      })
      .catch((e: any) => console.warn("[migrate-token] AppSettings update failed:", e?.message));

    console.log(`[migrate-token] ✓ Token migrated for ${shop}, expires ${expiresAt.toISOString()}`);
  } catch (e: any) {
    return respond(500, {
      error: "Token exchange succeeded but DB update failed",
      message: e?.message,
      newTokenPrefix: newToken.slice(0, 12) + "…",
      expiresAt,
    });
  }

  return respond(200, {
    success: true,
    message: "Token successfully migrated to expiring token. Redemption should now work.",
    oldTokenPrefix: currentToken.slice(0, 12) + "…",
    newTokenPrefix: newToken.slice(0, 12) + "…",
    tokenChanged: currentToken !== newToken,
    expiresAt,
    refreshTokenStored: !!refreshToken,
    scope,
  });
};

function respond(status: number, data: unknown) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
