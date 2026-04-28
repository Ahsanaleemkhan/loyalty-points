import prisma from "../db.server";
import type { Settings } from "./settings.server";

export interface RedeemResult {
  success: boolean;
  discountCode?: string;
  discountValue?: number;
  pointsSpent?: number;
  newBalance?: number;
  error?: string;
}

/** How much discount (in store currency) a given points amount is worth */
export function pointsToDiscount(points: number, settings: Settings): number {
  return parseFloat(
    ((points / settings.pointsPerDiscount) * settings.discountValue).toFixed(2),
  );
}

/** Minimum discount value (maps minPointsRedeem → dollars) */
export function minDiscount(settings: Settings): number {
  return pointsToDiscount(settings.minPointsRedeem, settings);
}

interface AdminGraphql {
  (query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

/**
 * Creates a Shopify discount code (price rule + discount code) and records the redemption.
 */
export async function createRedemption(params: {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  pointsToRedeem: number;
  settings: Settings;
  admin: { graphql: AdminGraphql };
  currentBalance: number;
}): Promise<RedeemResult> {
  const { shop, customerId, customerEmail, customerName, pointsToRedeem, settings, admin, currentBalance } = params;

  if (!settings.redemptionEnabled) {
    return { success: false, error: "Redemptions are currently disabled." };
  }
  if (pointsToRedeem < settings.minPointsRedeem) {
    return { success: false, error: `Minimum redemption is ${settings.minPointsRedeem} points.` };
  }
  if (pointsToRedeem > currentBalance) {
    return { success: false, error: "Insufficient points balance." };
  }

  const discountAmount = pointsToDiscount(pointsToRedeem, settings);
  const code = `LOYALTY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // Create Shopify price rule + discount code
  let discountGid = "";
  try {
    const priceRuleRes = await admin.graphql(
      `#graphql
      mutation priceRuleCreate($input: PriceRuleInput!) {
        priceRuleCreate(input: $input) {
          priceRule {
            id
          }
          priceRuleUserErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            title: `Loyalty Redemption — ${code}`,
            target: "LINE_ITEM",
            value: { percentageValue: null, fixedAmountValue: `-${discountAmount}` },
            allocationMethod: "ACROSS",
            valueV2: { amount: discountAmount, currencyCode: settings.currency },
            customerSelection: { forAllCustomers: true },
            usageLimit: 1,
            oncePerCustomer: true,
            startsAt: new Date().toISOString(),
          },
        },
      },
    );
    const priceRuleJson = await priceRuleRes.json() as {
      data?: { priceRuleCreate?: { priceRule?: { id: string } } };
    };
    discountGid = priceRuleJson.data?.priceRuleCreate?.priceRule?.id ?? "";

    if (discountGid) {
      await admin.graphql(
        `#graphql
        mutation priceRuleDiscountCodeCreate($priceRuleId: ID!, $code: String!) {
          priceRuleDiscountCodeCreate(priceRuleId: $priceRuleId, code: $code) {
            priceRuleDiscountCode { code }
            userErrors { field message }
          }
        }`,
        { variables: { priceRuleId: discountGid, code } },
      );
    }
  } catch (err) {
    console.error("Shopify discount creation failed:", err);
    return { success: false, error: "Failed to create discount code. Please try again." };
  }

  // Record redemption + deduct points in a transaction
  const newBalance = await prisma.$transaction(async (tx) => {
    await tx.redemption.create({
      data: {
        shop,
        customerId,
        customerEmail,
        customerName,
        pointsSpent: pointsToRedeem,
        discountValue: discountAmount,
        discountCode: code,
        discountGid,
      },
    });
    await tx.pointsTransaction.create({
      data: {
        shop,
        customerId,
        customerEmail,
        customerName,
        points: -pointsToRedeem,
        type: "REDEEMED",
        note: `Redeemed for discount code ${code} (${settings.currency} ${discountAmount.toFixed(2)})`,
      },
    });
    const agg = await tx.pointsTransaction.aggregate({
      where: { shop, customerId },
      _sum: { points: true },
    });
    return agg._sum.points ?? 0;
  });

  return {
    success: true,
    discountCode: code,
    discountValue: discountAmount,
    pointsSpent: pointsToRedeem,
    newBalance,
  };
}

export async function getRedemptions(shop: string, customerId?: string) {
  return prisma.redemption.findMany({
    where: { shop, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}
