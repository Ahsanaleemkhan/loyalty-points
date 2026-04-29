/**
 * GET /api/force-reauth?shop=xxx.myshopify.com
 *
 * One-time fix endpoint for shops stuck on a deprecated non-expiring token.
 * Deletes the existing offline session + cached admin token, then redirects
 * to /auth which starts a fresh OAuth flow. With use_legacy_install_flow=false
 * Shopify issues a new expiring token that the Admin API accepts.
 *
 * MUST be opened in a regular browser tab (NOT from inside the embedded
 * Shopify Admin iframe) — the OAuth screen sets X-Frame-Options: DENY and
 * cannot render inside an iframe.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return new Response(
      "<h2>Missing or invalid ?shop=xxx.myshopify.com</h2>",
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  // Detect if this looks like an embedded iframe load — if so, show a page
  // that breaks out of the iframe instead of redirecting (which would 403).
  const isEmbedded = url.searchParams.get("embedded") === "1" || request.headers.get("sec-fetch-dest") === "iframe";

  // Wipe the deprecated session + cached token so the OAuth callback creates
  // a fresh row (rather than the SDK shortcutting back to the bad token).
  try {
    await prisma.session.deleteMany({ where: { shop, isOnline: false } });
    await prisma.appSettings
      .update({
        where: { shop },
        data: { adminAccessToken: null, adminTokenExpires: null },
      })
      .catch(() => {}); // row may not exist yet
    console.log(`[force-reauth] Cleared stale credentials for ${shop}`);
  } catch (e: any) {
    console.error(`[force-reauth] DB cleanup failed for ${shop}:`, e?.message);
  }

  const authUrl = `/auth?shop=${encodeURIComponent(shop)}`;

  if (isEmbedded) {
    // Top-level break-out so the consent screen renders outside the iframe
    const html = `<!DOCTYPE html>
<html><head><title>Refreshing app credentials…</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center">
  <h2>Refreshing app credentials…</h2>
  <p>Opening Shopify consent screen in a new tab.</p>
  <p><a href="${authUrl}" target="_top">Click here if not redirected</a></p>
  <script>
    // Break out of the embedded iframe to top-level navigation
    if (window.top && window.top !== window.self) {
      window.top.location.href = ${JSON.stringify(authUrl)};
    } else {
      window.location.href = ${JSON.stringify(authUrl)};
    }
  </script>
</body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  }

  // Normal browser tab — direct redirect is fine
  return redirect(authUrl);
};
