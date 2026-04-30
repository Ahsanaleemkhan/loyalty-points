/**
 * Shopify billing plan definitions.
 * Must match exactly what is listed in the Shopify App Store.
 */

// Driven by env var — set BILLING_TEST_MODE=false in production .env
export const BILLING_TEST_MODE = process.env.BILLING_TEST_MODE !== "false";

// Free plan requires no subscription — enforced by null/undefined active plan
export const BILLING_PLAN_NAMES = ["Starter", "Growth", "Pro"] as const;

export type BillingPlanName = (typeof BILLING_PLAN_NAMES)[number];
export type PlanTier = "Free" | BillingPlanName;

export function isBillingPlanName(name: string): name is BillingPlanName {
  return (BILLING_PLAN_NAMES as readonly string[]).includes(name);
}

export interface BillingPlanDetails {
  title: string;
  description: string;
  monthlyPriceUsd: number;
  trialDays: number;
  features: string[];
  recommended?: boolean;
  // Limits
  monthlyOrderLimit: number;   // Max orders that earn points per month
  multiStore: boolean;
  advancedAnalytics: boolean;
  pointsExpiry: boolean;
  vipTiers: boolean;
  physicalReceipts: boolean;
  aiChatbot: boolean;
  referralProgram: boolean;
  birthdayRewards: boolean;
  apiAccess: boolean;
}

/** Free tier — no subscription needed, all core features included */
export const FREE_PLAN: BillingPlanDetails = {
  title: "Free",
  description: "Get started with loyalty points. All core features included.",
  monthlyPriceUsd: 0,
  trialDays: 0,
  recommended: false,
  monthlyOrderLimit: 100,
  multiStore: false,
  advancedAnalytics: false,
  pointsExpiry: false,
  vipTiers: false,
  physicalReceipts: true,
  aiChatbot: true,
  referralProgram: true,
  birthdayRewards: true,
  apiAccess: false,
  features: [
    "Up to 100 monthly orders",
    "Loyalty points system",
    "Earn & redeem points",
    "Physical receipt submissions",
    "Birthday rewards",
    "Referral program",
    "AI chat assistant",
    "Email support",
  ],
};

export const BILLING_PLAN_DETAILS: Record<BillingPlanName, BillingPlanDetails> = {
  Starter: {
    title: "Starter",
    description: "Loyalty points program for growing stores.",
    monthlyPriceUsd: 19,
    trialDays: 7,
    recommended: false,
    monthlyOrderLimit: 500,
    multiStore: false,
    advancedAnalytics: false,
    pointsExpiry: false,
    vipTiers: false,
    physicalReceipts: true,
    aiChatbot: false,
    referralProgram: false,
    birthdayRewards: false,
    apiAccess: false,
    features: [
      "Up to 500 monthly orders",
      "Loyalty points program",
      "Earn and redeem points",
      "Basic rewards (discounts)",
      "Points on product and cart",
      "Physical receipt submissions",
      "Basic analytics",
      "Email support",
    ],
  },
  Growth: {
    title: "Growth",
    description: "Advanced loyalty features for scaling businesses.",
    monthlyPriceUsd: 79,
    trialDays: 3,
    recommended: true,
    monthlyOrderLimit: 2000,
    multiStore: true,
    advancedAnalytics: true,
    pointsExpiry: true,
    vipTiers: false,
    physicalReceipts: true,
    aiChatbot: true,
    referralProgram: true,
    birthdayRewards: true,
    apiAccess: false,
    features: [
      "Everything in Starter",
      "Up to 2,000 monthly orders",
      "Multi-store loyalty sync",
      "Advanced analytics and reports",
      "Points expiration rules",
      "Customer segmentation",
      "Referral program",
      "Birthday rewards",
      "AI chat assistant",
      "Priority support",
    ],
  },
  Pro: {
    title: "Pro",
    description: "Full-featured loyalty platform for high-volume merchants.",
    monthlyPriceUsd: 199,
    trialDays: 7,
    recommended: false,
    monthlyOrderLimit: 10000,
    multiStore: true,
    advancedAnalytics: true,
    pointsExpiry: true,
    vipTiers: true,
    physicalReceipts: true,
    aiChatbot: true,
    referralProgram: true,
    birthdayRewards: true,
    apiAccess: true,
    features: [
      "Everything in Growth",
      "Up to 10,000 monthly orders",
      "Advanced loyalty rules",
      "VIP tiers and rewards",
      "API access",
      "Custom integrations",
      "Dedicated support",
    ],
  },
};

/** Get plan details by tier name (including Free) */
export function getPlanDetails(tier: PlanTier): BillingPlanDetails {
  if (tier === "Free") return FREE_PLAN;
  return BILLING_PLAN_DETAILS[tier];
}

/** Resolve the active plan tier from a subscription name (null = Free) */
export function resolvePlanTier(subscriptionName: string | null): PlanTier {
  if (!subscriptionName || !isBillingPlanName(subscriptionName)) return "Free";
  return subscriptionName;
}
