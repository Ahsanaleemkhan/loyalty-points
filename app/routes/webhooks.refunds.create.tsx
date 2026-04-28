/**
 * REFUNDS_CREATE webhook handler.
 * Deducts points proportionally when an order is refunded.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import prisma from "../db.server";
import { syncPointsToMetafield } from "../models/points.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload, admin } =
    await authenticate.webhook(request);

  if (topic !== "REFUNDS_CREATE") return new Response("OK", { status: 200 });
  if (!admin || !session) return new Response("No session", { status: 200 });

  try {
    const refund = payload as {
      order_id: number;
      refund_line_items?: { subtotal: number }[];
      transactions?: { amount: string }[];
    };

    const orderId = String(refund.order_id);

    // Find the original EARNED_ONLINE transaction for this order
    const originalTx = await prisma.pointsTransaction.findFirst({
      where: { shop, orderId, type: "EARNED_ONLINE" },
    });
    if (!originalTx) return new Response("No original transaction", { status: 200 });

    // Calculate refund amount
    const refundAmount = (refund.transactions ?? []).reduce((s, t) => s + parseFloat(t.amount ?? "0"), 0);
    if (refundAmount <= 0) return new Response("No refund amount", { status: 200 });

    const settings = await getSettings(shop);
    if (!settings.isEnabled) return new Response("Disabled", { status: 200 });

    // Find the original order amount from the note (best effort) or deduce proportionally
    // Deduct proportional points: (refundAmount / orderAmount) * pointsAwarded
    // We use a conservative estimate: refundAmount * (pointsPerAmount / amountPerPoints)
    const pointsToDeduct = Math.ceil(refundAmount * (settings.pointsPerAmount / settings.amountPerPoints));
    if (pointsToDeduct <= 0) return new Response("No points to deduct", { status: 200 });

    // Check customer still has enough balance
    const balanceResult = await prisma.pointsTransaction.aggregate({
      where: { shop, customerId: originalTx.customerId },
      _sum: { points: true },
    });
    const currentBalance = balanceResult._sum.points ?? 0;
    const actualDeduct   = Math.min(pointsToDeduct, currentBalance);
    if (actualDeduct <= 0) return new Response("Insufficient balance", { status: 200 });

    // Check this refund hasn't been processed already
    const alreadyProcessed = await prisma.pointsTransaction.count({
      where: { shop, orderId, type: "MANUAL_ADJUST", note: { contains: "Refund" } },
    });
    if (alreadyProcessed > 0) return new Response("Already processed", { status: 200 });

    await prisma.pointsTransaction.create({
      data: {
        shop,
        customerId:    originalTx.customerId,
        customerEmail: originalTx.customerEmail,
        customerName:  originalTx.customerName,
        points:        -actualDeduct,
        type:          "MANUAL_ADJUST",
        orderId,
        note:          `Refund for order #${orderId} — ${refundAmount.toFixed(2)} ${settings.currency}`,
      },
    });

    // Sync new balance to metafield
    const newBalance = currentBalance - actualDeduct;
    await syncPointsToMetafield(originalTx.customerId, newBalance, admin).catch(() => {});

    console.log(`Deducted ${actualDeduct} points for refund on order ${orderId}`);
  } catch (err) {
    console.error("Refund webhook error:", err);
  }

  return new Response("OK", { status: 200 });
};
