import { BillingInterval, BillingReplacementBehavior } from "@shopify/shopify-api";

export const BILLING_PLAN_STARTER = "Starter" as const;
export const BILLING_PLAN_GROWTH = "Growth" as const;
export const BILLING_PLAN_SCALE = "Scale" as const;

export const BILLING_PLAN_NAMES = [
  BILLING_PLAN_STARTER,
  BILLING_PLAN_GROWTH,
  BILLING_PLAN_SCALE,
] as const;

export type BillingPlanName = (typeof BILLING_PLAN_NAMES)[number];

export const BILLING_TRIAL_DAYS = 14;

// Test charges should be enabled in development and disabled in production by default.
export const BILLING_TEST_MODE =
  process.env.SHOPIFY_BILLING_TEST_MODE === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.SHOPIFY_BILLING_TEST_MODE !== "false");

export const BILLING_CONFIG: Record<
  BillingPlanName,
  {
    trialDays: number;
    replacementBehavior: BillingReplacementBehavior;
    lineItems: Array<{
      amount: number;
      currencyCode: "USD";
      interval: BillingInterval.Every30Days;
    }>;
  }
> = {
  [BILLING_PLAN_STARTER]: {
    trialDays: BILLING_TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    lineItems: [
      {
        amount: 9,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [BILLING_PLAN_GROWTH]: {
    trialDays: BILLING_TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    lineItems: [
      {
        amount: 29,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [BILLING_PLAN_SCALE]: {
    trialDays: BILLING_TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    lineItems: [
      {
        amount: 79,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
};

export const BILLING_PLAN_DETAILS: Record<
  BillingPlanName,
  {
    title: string;
    description: string;
    monthlyPriceUsd: number;
    trialDays: number;
    recommended?: boolean;
    features: string[];
  }
> = {
  [BILLING_PLAN_STARTER]: {
    title: "Starter",
    description: "Best for new stores launching loyalty for the first time.",
    monthlyPriceUsd: 9,
    trialDays: BILLING_TRIAL_DAYS,
    features: [
      "Automatic points on paid orders",
      "Customer balances and transaction history",
      "Theme widget with points balance and history",
      "Email support",
    ],
  },
  [BILLING_PLAN_GROWTH]: {
    title: "Growth",
    description: "For growing stores that need advanced loyalty workflows.",
    monthlyPriceUsd: 29,
    trialDays: BILLING_TRIAL_DAYS,
    recommended: true,
    features: [
      "Everything in Starter",
      "Physical receipt submissions and admin approvals",
      "Referral program and earning rules",
      "VIP tiers, redemptions, and analytics",
    ],
  },
  [BILLING_PLAN_SCALE]: {
    title: "Scale",
    description: "For high-volume stores that need premium support and scale.",
    monthlyPriceUsd: 79,
    trialDays: BILLING_TRIAL_DAYS,
    features: [
      "Everything in Growth",
      "Priority support",
      "Advanced rollout support for enterprise stores",
      "Best fit for large loyalty programs",
    ],
  },
};

export function isBillingPlanName(value: string): value is BillingPlanName {
  return (BILLING_PLAN_NAMES as readonly string[]).includes(value);
}
