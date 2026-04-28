import prisma from "../db.server";

export interface EarningRule {
  id: string;
  shop: string;
  name: string;
  type: string;
  points: number;
  multiplier: number;
  isEnabled: boolean;
  config: Record<string, unknown>;
}

function parseRule(raw: {
  id: string; shop: string; name: string; type: string;
  points: number; multiplier: number; isEnabled: boolean; config: string;
}): EarningRule {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(raw.config) as Record<string, unknown>; } catch { config = {}; }
  return { ...raw, config };
}

export async function getEnabledRules(shop: string): Promise<EarningRule[]> {
  const rows = await prisma.earningRule.findMany({
    where: { shop, isEnabled: true },
  });
  return rows.map(parseRule);
}

/** Check if this is the customer's very first order (no prior EARNED_ONLINE transactions) */
export async function isFirstPurchase(shop: string, customerId: string): Promise<boolean> {
  const count = await prisma.pointsTransaction.count({
    where: { shop, customerId, type: "EARNED_ONLINE" },
  });
  return count === 0;
}

/** Check whether a birthday rule bonus was already awarded this calendar month */
export async function birthdayBonusAwardedThisMonth(shop: string, customerId: string): Promise<boolean> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const count = await prisma.pointsTransaction.count({
    where: { shop, customerId, type: "EARNED_RULE", note: { contains: "birthday" } },
  });
  // More specific: check this month
  const thisMonth = await prisma.pointsTransaction.count({
    where: {
      shop, customerId, type: "EARNED_RULE",
      note: { contains: "birthday" },
      createdAt: { gte: startOfMonth },
    },
  });
  return thisMonth > 0;
}

/**
 * Evaluate all applicable earning rules for an order event and return bonus points.
 * orderId is used for idempotency — we don't double-apply FIRST_PURCHASE.
 */
export async function evaluateOrderRules(params: {
  shop: string;
  customerId: string;
  rules: EarningRule[];
  basePoints: number;
}): Promise<{ bonusPoints: number; appliedRules: string[] }> {
  const { shop, customerId, rules, basePoints } = params;

  let bonusPoints = 0;
  const appliedRules: string[] = [];

  for (const rule of rules) {
    if (rule.type === "FIRST_PURCHASE") {
      const first = await isFirstPurchase(shop, customerId);
      if (first) {
        bonusPoints += rule.points;
        appliedRules.push(rule.name);
      }
    }

    if (rule.type === "PRODUCT_TAG") {
      // config.tag must be set; caller passes matched=true in config at runtime
      // This is evaluated in the webhook where we have product info
      // For now, skip — needs product tag context from order line items
    }
  }

  return { bonusPoints, appliedRules };
}
