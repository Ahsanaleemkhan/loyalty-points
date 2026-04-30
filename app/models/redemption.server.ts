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
  if (currentBalance <= 0 || pointsToRedeem > currentBalance) {
    return { success: false, error: "Insufficient points balance." };
  }

  const discountAmount = pointsToDiscount(pointsToRedeem, settings);
  const code = `LOYALTY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // Create Shopify discount code via the modern Discount API
  let discountGid = "";
  try {
    const createRes = await admin.graphql(
      `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                codes(first: 1) { edges { node { code } } }
              }
            }
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          basicCodeDiscount: {
            title: `Loyalty Redemption — ${code}`,
            code,
            startsAt: new Date().toISOString(),
            usageLimit: 1,
            appliesOncePerCustomer: true,
            customerGets: {
              value: { discountAmount: { amount: discountAmount.toFixed(2), appliesOnEachItem: false } },
              items: { all: true },
            },
            customerSelection: { all: true },
          },
        },
      },
    );

    // Read raw text first so we can surface non-JSON / 403 HTML responses
    const rawText = await createRes.text();
    if (!createRes.ok) {
      console.error(`[redeem] Shopify HTTP ${createRes.status}:`, rawText.slice(0, 500));
      if (createRes.status === 403 || createRes.status === 401) {
        return {
          success: false,
          error: "Shopify rejected the request — the app's access token is missing the 'write_discounts' permission or has expired. Please uninstall and reinstall the app from your Shopify Admin to refresh permissions.",
        };
      }
      return { success: false, error: `Shopify HTTP ${createRes.status}: ${rawText.slice(0, 200)}` };
    }

    let createJson: {
      data?: { discountCodeBasicCreate?: { codeDiscountNode?: { id: string }; userErrors?: { message: string; field?: string[] }[] } };
      errors?: { message: string }[];
    };
    try {
      createJson = JSON.parse(rawText);
    } catch {
      console.error("[redeem] Non-JSON response from Shopify:", rawText.slice(0, 500));
      return { success: false, error: `Unexpected Shopify response: ${rawText.slice(0, 200)}` };
    }

    const gqlErrors  = createJson.errors ?? [];
    const userErrors = createJson.data?.discountCodeBasicCreate?.userErrors ?? [];

    if (gqlErrors.length > 0) {
      console.error("[redeem] GraphQL errors:", JSON.stringify(gqlErrors));
      const msg = gqlErrors.map((e) => e.message).join(", ");
      if (/access|permission|forbidden|scope/i.test(msg)) {
        return { success: false, error: "App is missing the 'write_discounts' permission. Please uninstall and reinstall the app to grant updated permissions." };
      }
      return { success: false, error: `Shopify error: ${msg}` };
    }
    if (userErrors.length > 0) {
      console.error("[redeem] User errors:", JSON.stringify(userErrors));
      return { success: false, error: `Discount error: ${userErrors.map((e) => e.message).join(", ")}` };
    }

    discountGid = createJson.data?.discountCodeBasicCreate?.codeDiscountNode?.id ?? "";
  } catch (err: any) {
    let msg = "Unknown error";
    if (err instanceof Response) {
      try {
        const body = await err.clone().text();
        msg = `HTTP ${err.status}: ${body.slice(0, 300)}`;
        if (err.status === 403 || err.status === 401) {
          return {
            success: false,
            error: "Shopify rejected the request (token missing 'write_discounts' or expired). Please uninstall and reinstall the app from Shopify Admin to refresh permissions.",
          };
        }
      } catch {
        msg = `HTTP ${err.status}`;
      }
    } else {
      msg = err?.message ?? String(err);
    }
    console.error("[redeem] Shopify discount creation failed:", msg);
    return { success: false, error: `Discount creation failed: ${msg}` };
  }

  // Record redemption + deduct points atomically.
  // Re-check balance INSIDE the transaction to prevent race conditions
  // (e.g. double-click or two simultaneous requests both passing the pre-check).
  let newBalance: number;
  try {
    newBalance = await prisma.$transaction(async (tx) => {
      // Atomic balance re-check — prevents overdraft from concurrent requests
      const freshAgg = await tx.pointsTransaction.aggregate({
        where: { shop, customerId },
        _sum: { points: true },
      });
      const freshBalance = freshAgg._sum.points ?? 0;
      if (freshBalance <= 0 || pointsToRedeem > freshBalance) {
        throw new Error(`INSUFFICIENT:${freshBalance}`);
      }

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
      const afterAgg = await tx.pointsTransaction.aggregate({
        where: { shop, customerId },
        _sum: { points: true },
      });
      return afterAgg._sum.points ?? 0;
    });
  } catch (txErr: any) {
    if (txErr.message?.startsWith("INSUFFICIENT:")) {
      return { success: false, error: "Insufficient points balance." };
    }
    console.error("[redeem] Transaction failed:", txErr?.message);
    return { success: false, error: "Failed to record redemption. Please try again." };
  }

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
