/**
 * POST /api/redeem
 * Called by the customer-facing widget to redeem points for a discount code.
 * Uses the best available session token — prefers online (always expiring/accepted)
 * over offline (may be deprecated non-expiring).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getSettings } from "../models/settings.server";
import { getCustomerPointsBalance } from "../models/transactions.server";
import { createRedemption } from "../models/redemption.server";
import { syncPointsToMetafield } from "../models/points.server";
import { apiVersion } from "../shopify.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// React Router v7 routes OPTIONS to loader, not action — must handle here
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
};

/** Build a lightweight admin GraphQL client that calls Shopify directly via fetch */
function makeAdminClient(shop: string, accessToken: string) {
  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      return fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: options?.variables ?? {} }),
      });
    },
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const { shop, customerId, customerEmail, customerName, pointsToRedeem } = body as Record<string, string | number>;

    console.log(`[api/redeem] Request: shop=${shop} customer=${customerId} pts=${pointsToRedeem}`);

    if (!shop || !customerId || !customerEmail || !pointsToRedeem) {
      return json({ error: "Missing required fields: shop, customerId, customerEmail, pointsToRedeem" }, 400);
    }

    // Token resolution priority:
    //   1. Cached fresh admin token from AppSettings (set when merchant opens the embedded app).
    //      This is an expiring online token from token exchange — Shopify accepts it.
    //   2. Online session in the Session table (token exchange tokens).
    //   3. Offline session (install-time OAuth token — may be deprecated non-expiring shpat_).
    const [appSettingsRow, onlineSession, offlineSession] = await Promise.all([
      prisma.appSettings.findUnique({ where: { shop: String(shop) } }),
      prisma.session.findFirst({
        where: {
          shop: String(shop),
          isOnline: true,
          OR: [{ expires: null }, { expires: { gt: new Date() } }],
        },
        orderBy: { expires: "desc" },
      }),
      prisma.session.findFirst({
        where: { shop: String(shop), isOnline: false },
      }),
    ]);

    const cachedTokenValid =
      !!appSettingsRow?.adminAccessToken &&
      (!appSettingsRow.adminTokenExpires || appSettingsRow.adminTokenExpires > new Date());

    let accessToken: string | null = null;
    let tokenType = "none";
    let scopeForCheck = offlineSession?.scope ?? onlineSession?.scope ?? "";

    if (cachedTokenValid) {
      accessToken = appSettingsRow!.adminAccessToken!;
      tokenType = "cached-admin";
      // Cached token came from authenticate.admin which already passed scope checks
      scopeForCheck = onlineSession?.scope ?? offlineSession?.scope ?? "write_discounts";
    } else if (onlineSession?.accessToken) {
      accessToken = onlineSession.accessToken;
      tokenType = "online";
      scopeForCheck = onlineSession.scope ?? "";
    } else if (offlineSession?.accessToken) {
      accessToken = offlineSession.accessToken;
      tokenType = "offline";
      scopeForCheck = offlineSession.scope ?? "";
    }

    console.log(
      `[api/redeem] Token: type=${tokenType} cachedValid=${cachedTokenValid} online=${!!onlineSession} offline=${!!offlineSession}`,
    );

    if (!accessToken) {
      return json({
        error: "App not installed on this store. Please install the app first.",
      }, 403);
    }

    // If we're falling back to offline token, check that it's not the deprecated one.
    if (tokenType === "offline") {
      console.warn("[api/redeem] Using offline token — may be deprecated. Asking merchant to refresh.");
      return json({
        error: "Session expired. Please ask the store admin to open the Customer Loyalty Points app from Shopify Admin once — this refreshes the access token. Then try redeeming again.",
      }, 403);
    }

    // Check write_discounts scope (skip for cached token since it came from a valid auth)
    if (tokenType !== "cached-admin") {
      const sessionScopes = scopeForCheck.split(",").map((s) => s.trim()).filter(Boolean);
      if (!sessionScopes.includes("write_discounts")) {
        console.error(`[api/redeem] Missing write_discounts. Scopes: [${sessionScopes.join(", ")}]`);
        return json({
          error: "App permissions are out of date. Please uninstall and reinstall the app from Shopify Admin.",
        }, 403);
      }
    }

    const admin = makeAdminClient(String(shop), accessToken);
    console.log(`[api/redeem] Using ${tokenType} token to call Admin API`);

    const [settings, currentBalance] = await Promise.all([
      getSettings(String(shop)),
      getCustomerPointsBalance(String(shop), String(customerId)),
    ]);

    console.log(`[api/redeem] Balance=${currentBalance} ptsToRedeem=${pointsToRedeem} min=${settings.minPointsRedeem} enabled=${settings.redemptionEnabled}`);

    const result = await createRedemption({
      shop: String(shop),
      customerId: String(customerId),
      customerEmail: String(customerEmail),
      customerName: String(customerName || ""),
      pointsToRedeem: Number(pointsToRedeem),
      settings,
      admin,
      currentBalance,
    });

    console.log(`[api/redeem] Result: success=${result.success} error=${result.error ?? "none"} code=${result.discountCode ?? "none"}`);

    if (!result.success) return json({ error: result.error }, 400);

    // Sync new balance to metafield (non-fatal)
    if (result.newBalance !== undefined) {
      await syncPointsToMetafield(String(customerId), result.newBalance, admin).catch((e) => {
        console.warn(`[api/redeem] metafield sync failed (non-fatal): ${e?.message}`);
      });
    }

    return json({
      success: true,
      discountCode: result.discountCode,
      discountValue: result.discountValue,
      pointsSpent: result.pointsSpent,
      newBalance: result.newBalance,
      currency: settings.currency,
    });
  } catch (err: any) {
    const msg = err instanceof Response
      ? `HTTP ${err.status}`
      : (err?.message ?? "Unexpected server error");
    console.error("[api/redeem] Unhandled error:", msg, err?.stack ?? "");
    return json({ error: `Server error: ${msg}` }, 500);
  }
};
