/**
 * POST /api/redeem
 * Called by the customer-facing widget to redeem points for a discount code.
 * Uses Shopify offline access token stored in session.
 */
import type { ActionFunctionArgs } from "react-router";
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

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { shop, customerId, customerEmail, customerName, pointsToRedeem } = body as Record<string, string | number>;

  if (!shop || !customerId || !customerEmail || !pointsToRedeem) {
    return json({ error: "Missing required fields" }, 400);
  }

  // Get offline session for this shop to use admin API
  const session = await prisma.session.findFirst({
    where: { shop: String(shop), isOnline: false },
  });
  if (!session) return json({ error: "App not installed on this store" }, 403);

  const { admin } = await shopify.unauthenticated.admin(String(shop));

  const [settings, currentBalance] = await Promise.all([
    getSettings(String(shop)),
    getCustomerPointsBalance(String(shop), String(customerId)),
  ]);

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

  if (!result.success) return json({ error: result.error }, 400);

  // Sync new balance to metafield
  if (result.newBalance !== undefined) {
    await syncPointsToMetafield(String(customerId), result.newBalance, admin).catch(() => {});
  }

  return json({
    success: true,
    discountCode: result.discountCode,
    discountValue: result.discountValue,
    pointsSpent: result.pointsSpent,
    newBalance: result.newBalance,
    currency: settings.currency,
  });
};
