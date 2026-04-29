/**
 * GET /api/debug-token?shop=xxx.myshopify.com
 *
 * Diagnostic endpoint — hits Shopify Admin API with the stored token
 * and reports what's actually failing. Helps distinguish between:
 *   - Bad/expired token (401)
 *   - Missing scope (403)
 *   - Network/other (5xx)
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { apiVersion } from "../shopify.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return json({ error: "Missing ?shop=" }, 400);

  // Pull every credential we have for this shop
  const [appSettings, sessions] = await Promise.all([
    prisma.appSettings.findUnique({ where: { shop } }),
    prisma.session.findMany({ where: { shop } }),
  ]);

  const tokens: Array<{ source: string; token: string; scope: string; expires: Date | null; isOnline: boolean }> = [];

  if (appSettings?.adminAccessToken) {
    tokens.push({
      source: "AppSettings.adminAccessToken (cached)",
      token: appSettings.adminAccessToken,
      scope: "(unknown — cached)",
      expires: appSettings.adminTokenExpires,
      isOnline: false,
    });
  }
  for (const s of sessions) {
    tokens.push({
      source: `Session ${s.id} (${s.isOnline ? "online" : "offline"})`,
      token: s.accessToken,
      scope: s.scope ?? "",
      expires: s.expires,
      isOnline: s.isOnline,
    });
  }

  if (tokens.length === 0) return json({ error: "No tokens found for shop", shop });

  // Test each token with two queries:
  //   A. shop { name } — baseline, works with any valid token regardless of scope
  //   B. priceRules(first:1) — needs read_price_rules
  //   C. attempt a tiny discount create — needs write_discounts
  const results = [];
  for (const t of tokens) {
    const r: any = {
      source: t.source,
      tokenPrefix: t.token.slice(0, 12) + "…",
      scope: t.scope,
      expires: t.expires,
      isOnline: t.isOnline,
      tokenIsExpired: t.expires ? t.expires < new Date() : "no-expiry-set",
    };

    // A. baseline shop query
    try {
      const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t.token },
        body: JSON.stringify({ query: "{ shop { name myshopifyDomain } }" }),
      });
      const body = await res.text();
      r.shopQuery = { status: res.status, ok: res.ok, body: body.slice(0, 400) };
    } catch (e: any) {
      r.shopQuery = { error: e?.message };
    }

    // B. price rules (needs read_price_rules / read_discounts)
    try {
      const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t.token },
        body: JSON.stringify({ query: "{ codeDiscountNodes(first: 1) { edges { node { id } } } }" }),
      });
      const body = await res.text();
      r.discountReadQuery = { status: res.status, ok: res.ok, body: body.slice(0, 400) };
    } catch (e: any) {
      r.discountReadQuery = { error: e?.message };
    }

    // C. attempt a discount CREATE (will create a real discount code if scope works!)
    try {
      const code = `DEBUG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t.token },
        body: JSON.stringify({
          query: `mutation($d: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $d) {
              codeDiscountNode { id }
              userErrors { field message }
            }
          }`,
          variables: {
            d: {
              title: `Debug ${code}`,
              code,
              startsAt: new Date().toISOString(),
              usageLimit: 1,
              appliesOncePerCustomer: true,
              customerGets: {
                value: { discountAmount: { amount: "1.00", appliesOnEachItem: false } },
                items: { all: true },
              },
              customerSelection: { all: true },
            },
          },
        }),
      });
      const body = await res.text();
      r.discountCreate = { status: res.status, ok: res.ok, body: body.slice(0, 600) };
    } catch (e: any) {
      r.discountCreate = { error: e?.message };
    }

    results.push(r);
  }

  return json({
    shop,
    apiVersion,
    timestamp: new Date().toISOString(),
    summary: {
      tokensFound: tokens.length,
      hasCachedAdminToken: !!appSettings?.adminAccessToken,
      sessionCount: sessions.length,
    },
    results,
  });
};
