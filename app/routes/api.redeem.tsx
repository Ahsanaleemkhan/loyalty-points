/**
 * POST /api/redeem
 * Called by the customer-facing widget to redeem points for a discount code.
 * Uses getValidAccessToken() which automatically refreshes expiring tokens.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getSettings } from "../models/settings.server";
import { getCustomerPointsBalance } from "../models/transactions.server";
import { createRedemption } from "../models/redemption.server";
import { syncPointsToMetafield } from "../models/points.server";
import { getValidAccessToken } from "../models/token.server";
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

    // Get a valid (auto-refreshed if needed) access token for this shop
    const tokenResult = await getValidAccessToken(String(shop));

    console.log(`[api/redeem] Token result: ${tokenResult?.tokenType ?? "null"}`);

    if (!tokenResult) {
      return json({
        error: "App not installed on this store. Please install the app first.",
      }, 403);
    }

    console.log(`[api/redeem] Using token type=${tokenResult.tokenType}`);

    const admin = makeAdminClient(String(shop), tokenResult.accessToken);

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
