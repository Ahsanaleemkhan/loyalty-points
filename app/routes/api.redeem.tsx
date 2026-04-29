/**
 * POST /api/redeem
 * Called by the customer-facing widget to redeem points for a discount code.
 * Uses Shopify offline access token stored in session.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getSettings } from "../models/settings.server";
import { getCustomerPointsBalance } from "../models/transactions.server";
import { createRedemption } from "../models/redemption.server";
import { syncPointsToMetafield } from "../models/points.server";
import shopify from "../shopify.server";

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

export const action = async ({ request }: ActionFunctionArgs) => {

  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const { shop, customerId, customerEmail, customerName, pointsToRedeem } = body as Record<string, string | number>;

    console.log(`[api/redeem] Request: shop=${shop} customer=${customerId} pts=${pointsToRedeem}`);

    if (!shop || !customerId || !customerEmail || !pointsToRedeem) {
      return json({ error: "Missing required fields: shop, customerId, customerEmail, pointsToRedeem" }, 400);
    }

    // Get offline session for this shop to use admin API
    const session = await prisma.session.findFirst({
      where: { shop: String(shop), isOnline: false },
    });

    console.log(`[api/redeem] Session found: ${!!session} (isOnline=false) scope="${session?.scope ?? "none"}"`);

    if (!session) {
      // Try any session as fallback
      const anySession = await prisma.session.findFirst({ where: { shop: String(shop) } });
      console.log(`[api/redeem] Any session found: ${!!anySession}, isOnline=${anySession?.isOnline}`);
      return json({ error: "App not installed on this store or session expired. Please reinstall the app." }, 403);
    }

    // Hard-check that the stored token has write_discounts — if not, OAuth must be redone.
    const sessionScopes = (session.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!sessionScopes.includes("write_discounts")) {
      console.error(`[api/redeem] Session is missing 'write_discounts' scope. Current scopes: [${sessionScopes.join(", ")}]`);
      return json({
        error: "App permissions are out of date. Please uninstall the app from your Shopify Admin (Settings → Apps and sales channels → Customer Loyalty Points → Uninstall), then reinstall it. This grants the 'write_discounts' permission required to create discount codes.",
      }, 403);
    }

    console.log(`[api/redeem] Getting admin client for ${shop}…`);
    let admin: any;
    try {
      const result = await shopify.unauthenticated.admin(String(shop));
      admin = result.admin;
      console.log(`[api/redeem] Admin client ready`);
    } catch (adminErr: any) {
      const msg = adminErr instanceof Response
        ? `HTTP ${adminErr.status}`
        : (adminErr?.message ?? String(adminErr));
      console.error(`[api/redeem] Failed to get admin client: ${msg}`);
      return json({ error: `Could not connect to Shopify API: ${msg}` }, 500);
    }

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

    // Sync new balance to metafield
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
