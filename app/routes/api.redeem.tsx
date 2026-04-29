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

    // Find best available session — online sessions use token-exchange tokens (always expiring/accepted).
    // Offline sessions may have deprecated non-expiring tokens.
    const [onlineSession, offlineSession] = await Promise.all([
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

    const session = onlineSession ?? offlineSession;
    const tokenType = onlineSession ? "online" : offlineSession ? "offline" : "none";

    console.log(`[api/redeem] Session: type=${tokenType} online=${!!onlineSession} offline=${!!offlineSession} scope="${session?.scope ?? "none"}"`);

    if (!session?.accessToken) {
      return json({
        error: "App not installed on this store or session expired. Please reinstall the app.",
      }, 403);
    }

    // Check write_discounts scope
    const sessionScopes = (session.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!sessionScopes.includes("write_discounts")) {
      console.error(`[api/redeem] Missing write_discounts. Scopes: [${sessionScopes.join(", ")}]`);
      return json({
        error: "App permissions are out of date. Please uninstall and reinstall the app from Shopify Admin to grant the required permissions.",
      }, 403);
    }

    const admin = makeAdminClient(String(shop), session.accessToken);
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
