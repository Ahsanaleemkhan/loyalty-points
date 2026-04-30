/**
 * Public API endpoint used by the theme extension widget.
 * Handles: GET (customer points balance) and POST (new physical submission).
 * No admin auth — called from the storefront.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { createSubmission } from "../models/submissions.server";
import { getCustomerPointsBalance, getTransactions } from "../models/transactions.server";
import { getSettings } from "../models/settings.server";
import { getRedemptions } from "../models/redemption.server";
import { getTiers, resolveCustomerTier } from "../models/tiers.server";
import { getGroupShops } from "../models/storeSync.server";
import { hasFeatureAccess } from "../utils/plan-limits.server";
import { resolvePlanTier } from "../billing/plans";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function shopExists(shop: string): Promise<boolean> {
  const session = await prisma.session.findFirst({ where: { shop } });
  return !!session;
}

// OPTIONS preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const rawId = url.searchParams.get("customerId");

  if (!shop || !rawId) {
    return json({ error: "Missing shop or customerId" }, 400);
  }

  // Normalise — Liquid sends plain numeric ID; DB stores full GID
  const customerId = rawId.startsWith("gid://")
    ? rawId
    : `gid://shopify/Customer/${rawId}`;

  const shopFound = await shopExists(shop);
  if (!shopFound) {
    console.error(`[api/widget] Unknown shop: ${shop}`);
    return json({ error: "Unknown shop — make sure the app is installed on this store." }, 403);
  }

  // Multi-store: aggregate balance + history across all group shops by email
  const groupShops = await getGroupShops(shop);
  const isMultiStore = groupShops.length > 1;
  const emailParam = url.searchParams.get("customerEmail") ?? "";

  let balance = 0;
  let storeBreakdown: { shop: string; label: string; points: number }[] = [];

  if (isMultiStore && emailParam) {
    // Sum across all group shops, and build per-store breakdown
    const perShopAggs = await Promise.all(
      groupShops.map(async (s) => {
        const agg = await prisma.pointsTransaction.aggregate({
          where: { shop: s, customerEmail: emailParam },
          _sum: { points: true },
        });
        return { shop: s, points: agg._sum.points ?? 0 };
      }),
    );
    balance = perShopAggs.reduce((sum, r) => sum + r.points, 0);
    storeBreakdown = perShopAggs
      .filter((r) => r.points !== 0)
      .map((r) => ({
        shop: r.shop,
        label: r.shop.replace(".myshopify.com", ""),
        points: r.points,
      }));
  } else {
    balance = await getCustomerPointsBalance(shop, customerId);
  }

  // Fetch transactions — cross-store when in group (match by email), single-shop otherwise
  const rawTransactions = isMultiStore && emailParam
    ? await prisma.pointsTransaction.findMany({
        where: { shop: { in: groupShops }, customerEmail: emailParam },
        orderBy: { createdAt: "desc" },
        take: 40,
      })
    : await getTransactions(shop, customerId);

  const [submissions, redemptions, settings, tiers] = await Promise.all([
    prisma.physicalSubmission.findMany({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, purchaseAmount: true, purchaseDate: true, pointsAwarded: true, createdAt: true },
    }),
    getRedemptions(shop, customerId),
    getSettings(shop),
    getTiers(shop),
  ]);

  const customerTier = settings.tiersEnabled ? resolveCustomerTier(balance, tiers) : null;

  // Expiring points: earned before (now - expiryDays + 30) and not yet expired
  let expiringPoints = 0;
  if (settings.pointsExpiryDays > 0) {
    const warnDate = new Date();
    warnDate.setDate(warnDate.getDate() - settings.pointsExpiryDays + 30);
    const [aboutToExpire, alreadyExpired] = await Promise.all([
      prisma.pointsTransaction.aggregate({
        where: { shop, customerId, points: { gt: 0 }, createdAt: { lt: warnDate }, type: { in: ["EARNED_ONLINE", "EARNED_PHYSICAL", "EARNED_RULE"] } },
        _sum: { points: true },
      }),
      prisma.pointsTransaction.aggregate({
        where: { shop, customerId, type: "EXPIRED" },
        _sum: { points: true },
      }),
    ]);
    expiringPoints = Math.max(0, (aboutToExpire._sum.points ?? 0) + (alreadyExpired._sum.points ?? 0));
  }

  return json({
    balance,
    isMultiStore,
    storeBreakdown,
    tier: customerTier ? { name: customerTier.name, color: customerTier.color, multiplier: customerTier.multiplier } : null,
    tiers: settings.tiersEnabled ? tiers.map((t) => ({ name: t.name, minPoints: t.minPoints, multiplier: t.multiplier, color: t.color })) : [],
    expiringPoints,
    submissions,
    transactions: rawTransactions.slice(0, 30).map((t) => ({
      id: t.id, type: t.type, points: t.points, note: t.note, createdAt: t.createdAt,
      fromShop: isMultiStore ? (t as any).shop?.replace(".myshopify.com", "") : undefined,
    })),
    redemptions: redemptions.slice(0, 10).map((r) => ({
      discountCode: r.discountCode, discountValue: r.discountValue, pointsSpent: r.pointsSpent,
      status: r.status, createdAt: r.createdAt,
    })),
    settings: {
      redemptionEnabled: settings.redemptionEnabled,
      pointsPerDiscount: settings.pointsPerDiscount,
      discountValue: settings.discountValue,
      minPointsRedeem: settings.minPointsRedeem,
      currency: settings.currency,
      pointsPerAmount: settings.pointsPerAmount,
      amountPerPoints: settings.amountPerPoints,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { shop, customerId, customerEmail, customerName, receiptData, receiptName, receiptType, receiptSize, purchaseAmount, purchaseDate, storeLocation, notes } = body as Record<string, string | number>;

  if (!shop || !customerId || !customerEmail || !receiptData || !purchaseAmount || !purchaseDate) {
    return json({ error: "Missing required fields" }, 400);
  }

  if (!(await shopExists(String(shop)))) {
    return json({ error: "Unknown shop" }, 403);
  }

  // Plan gate — physical receipts require Starter or above
  const shopSettings = await prisma.appSettings.findUnique({ where: { shop: String(shop) }, select: { planTier: true } });
  const tier = resolvePlanTier(shopSettings?.planTier ?? null);
  if (!hasFeatureAccess(tier, "physicalReceipts")) {
    return json({ error: "Physical receipt submissions require a paid plan. Please upgrade to Starter or above." }, 403);
  }

  // Validate file size (5MB limit in base64 ≈ 6.8MB string)
  if (String(receiptData).length > 7_000_000) {
    return json({ error: "File too large (max 5MB)" }, 400);
  }

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!ALLOWED_TYPES.includes(String(receiptType))) {
    return json({ error: "Invalid file type. Allowed: JPG, PNG, WebP, PDF" }, 400);
  }

  // Rate limit: max 3 pending submissions per customer
  const pendingCount = await prisma.physicalSubmission.count({
    where: { shop: String(shop), customerId: String(customerId), status: "PENDING" },
  });
  if (pendingCount >= 3) {
    return json({ error: "You have too many pending submissions. Please wait for them to be reviewed." }, 429);
  }

  const submission = await createSubmission({
    shop: String(shop),
    customerId: String(customerId),
    customerEmail: String(customerEmail),
    customerName: String(customerName || ""),
    receiptData: String(receiptData),
    receiptName: String(receiptName || "receipt"),
    receiptType: String(receiptType),
    receiptSize: Number(receiptSize || 0),
    purchaseAmount: Number(purchaseAmount),
    purchaseDate: String(purchaseDate),
    storeLocation: String(storeLocation || ""),
    notes: String(notes || ""),
  });

  return json({ success: true, submissionId: submission.id });
};
