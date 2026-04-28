/**
 * Plan enforcement utilities.
 * Call these in loaders/actions/webhooks to gate features by subscription tier.
 */

import prisma from "../db.server";
import {
  FREE_PLAN,
  BILLING_PLAN_DETAILS,
  getPlanDetails,
  resolvePlanTier,
  type BillingPlanDetails,
  type PlanTier,
} from "../billing/plans";

// ─── Get active plan for a shop ────────────────────────────────────────────

/**
 * Returns the active BillingPlanDetails for a shop.
 * Reads the Session table to find the shop's active Shopify subscription.
 * Falls back to Free if no paid subscription found.
 */
export async function getActivePlanForShop(
  shop: string,
  billing?: { check: Function }
): Promise<{ tier: PlanTier; plan: BillingPlanDetails }> {
  // If billing object is passed (from authenticate.admin), use it for live check
  if (billing) {
    try {
      const { BILLING_PLAN_NAMES, BILLING_TEST_MODE } = await import("../billing/plans");
      const result = await billing.check({
        plans: [...BILLING_PLAN_NAMES],
        isTest: BILLING_TEST_MODE,
      } as any);
      const active = result.appSubscriptions?.find(
        (s: any) => s.status === "ACTIVE"
      );
      const tier = resolvePlanTier(active?.name ?? null);
      return { tier, plan: getPlanDetails(tier) };
    } catch {
      // Fall through to Free
    }
  }
  return { tier: "Free", plan: FREE_PLAN };
}

// ─── Order limit enforcement ────────────────────────────────────────────────

/**
 * Count orders that earned points this calendar month for a shop.
 */
export async function getMonthlyOrderCount(shop: string): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  return prisma.pointsTransaction.count({
    where: {
      shop,
      type: "EARNED_ONLINE",
      createdAt: { gte: start },
    },
  });
}

/**
 * Returns true if the shop can still award points for a new order this month.
 */
export async function canAwardPointsForOrder(
  shop: string,
  tier: PlanTier
): Promise<boolean> {
  const plan = getPlanDetails(tier);
  const count = await getMonthlyOrderCount(shop);
  return count < plan.monthlyOrderLimit;
}

// ─── Feature gates ──────────────────────────────────────────────────────────

export type FeatureKey =
  | "multiStore"
  | "advancedAnalytics"
  | "pointsExpiry"
  | "vipTiers"
  | "physicalReceipts"
  | "aiChatbot"
  | "referralProgram"
  | "birthdayRewards"
  | "apiAccess";

/**
 * Returns true if the given plan tier has access to the feature.
 */
export function hasFeatureAccess(tier: PlanTier, feature: FeatureKey): boolean {
  const plan = getPlanDetails(tier);
  return !!plan[feature];
}

/**
 * Returns the minimum plan name that unlocks a feature.
 */
export function requiredPlanForFeature(feature: FeatureKey): PlanTier {
  for (const name of ["Starter", "Growth", "Pro"] as const) {
    if (BILLING_PLAN_DETAILS[name][feature]) return name;
  }
  return "Pro";
}

// ─── Upgrade prompt helpers ─────────────────────────────────────────────────

export interface UpgradePrompt {
  required: true;
  feature: string;
  requiredPlan: PlanTier;
  upgradeUrl: string;
}

export function buildUpgradePrompt(
  feature: FeatureKey,
  featureLabel: string
): UpgradePrompt {
  return {
    required: true,
    feature: featureLabel,
    requiredPlan: requiredPlanForFeature(feature),
    upgradeUrl: "/app/billing",
  };
}

// ─── Plan summary for UI ────────────────────────────────────────────────────

export interface PlanSummary {
  tier: PlanTier;
  monthlyOrderLimit: number;
  ordersUsedThisMonth: number;
  ordersRemaining: number;
  usagePercent: number;
  features: BillingPlanDetails;
}

export async function getPlanSummary(
  shop: string,
  tier: PlanTier
): Promise<PlanSummary> {
  const plan = getPlanDetails(tier);
  const ordersUsedThisMonth = await getMonthlyOrderCount(shop);
  const ordersRemaining = Math.max(0, plan.monthlyOrderLimit - ordersUsedThisMonth);
  const usagePercent = Math.min(
    100,
    Math.round((ordersUsedThisMonth / plan.monthlyOrderLimit) * 100)
  );
  return {
    tier,
    monthlyOrderLimit: plan.monthlyOrderLimit,
    ordersUsedThisMonth,
    ordersRemaining,
    usagePercent,
    features: plan,
  };
}
