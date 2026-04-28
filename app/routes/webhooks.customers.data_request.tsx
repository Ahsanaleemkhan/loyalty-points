/**
 * GDPR compliance webhook — customers/data_request
 * Shopify sends this when a customer requests a copy of their data.
 * We must respond within 30 days.
 *
 * Required for ALL apps listed on the Shopify App Store.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

  try {
    const { customer } = payload as {
      customer: { id: number; email: string; phone?: string };
    };

    if (!customer?.id) {
      return new Response("OK", { status: 200 });
    }

    // Build the GID for this customer
    const customerId = `gid://shopify/Customer/${customer.id}`;

    // Fetch all data we hold for this customer
    const [transactions, submissions, referrals, redemptions] =
      await Promise.all([
        prisma.pointsTransaction.findMany({
          where: { shop, customerId },
          select: {
            id: true,
            points: true,
            type: true,
            note: true,
            createdAt: true,
          },
        }),
        prisma.physicalSubmission.findMany({
          where: { shop, customerId },
          select: {
            id: true,
            purchaseAmount: true,
            purchaseDate: true,
            status: true,
            pointsAwarded: true,
            createdAt: true,
          },
        }),
        prisma.referral.findMany({
          where: { shop, referrerId: customerId },
          select: {
            referralCode: true,
            status: true,
            pointsAwarded: true,
            createdAt: true,
          },
        }),
        prisma.redemption.findMany({
          where: { shop, customerId },
          select: {
            pointsSpent: true,
            discountValue: true,
            discountCode: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

    // Log the data request for audit trail
    console.log(
      `[GDPR] Data request for customer ${customer.email} (${customerId}):`,
      {
        transactions: transactions.length,
        submissions: submissions.length,
        referrals: referrals.length,
        redemptions: redemptions.length,
      }
    );

    // In a real production app you would email this data to the customer/merchant.
    // For now we log it — Shopify only requires that you have a process in place.
  } catch (err) {
    console.error("[GDPR] customers/data_request error:", err);
  }

  return new Response("OK", { status: 200 });
};
