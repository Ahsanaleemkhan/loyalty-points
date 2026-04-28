import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, calculatePoints } from "../models/settings.server";
import { awardPoints } from "../models/points.server";
import { getCustomerPointsBalance } from "../models/transactions.server";
import { sendEmail, pointsEarnedEmail, tierUpgradeEmail } from "../utils/email.server";
import { formatMoney } from "../utils/currency";
import { getTiers, resolveCustomerTier, applyTierMultiplier } from "../models/tiers.server";
import { getEnabledRules, evaluateOrderRules } from "../models/earningRules.server";
import { getActivePlanForShop, canAwardPointsForOrder } from "../utils/plan-limits.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload, admin } =
    await authenticate.webhook(request);

  console.log(`[orders/paid] Received webhook — topic: ${topic}, shop: ${shop}`);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 200 });
  }

  if (!admin || !session) {
    console.error("[orders/paid] No admin/session — webhook auth failed");
    return new Response("No session", { status: 200 });
  }

  try {
    const order = payload as {
      id: number;
      total_price: string;
      customer?: {
        id: number;
        email: string;
        first_name?: string;
        last_name?: string;
      };
    };

    console.log(`[orders/paid] Order ID: ${(order as any).id}, total: ${(order as any).total_price}, has customer: ${!!order.customer}`);

    if (!order.customer) {
      console.warn(`[orders/paid] Order ${(order as any).id} has no customer — skipping`);
      return new Response("No customer on order", { status: 200 });
    }

    // Idempotency: skip if this order was already processed
    const alreadyProcessed = await prisma.pointsTransaction.count({
      where: { shop, orderId: String(order.id), type: "EARNED_ONLINE" },
    });
    if (alreadyProcessed > 0) {
      return new Response("Already processed", { status: 200 });
    }

    const [settings, tiers, rules] = await Promise.all([
      getSettings(shop),
      getTiers(shop),
      getEnabledRules(shop),
    ]);

    if (!settings.isEnabled) {
      return new Response("Points system disabled", { status: 200 });
    }

    // Plan limit: check monthly order quota before awarding points
    const { tier } = await getActivePlanForShop(shop);
    const withinLimit = await canAwardPointsForOrder(shop, tier);
    if (!withinLimit) {
      console.log(`[orders/paid] Shop ${shop} has reached monthly order limit for plan "${tier}". Skipping points for order ${(payload as any).id}.`);
      return new Response("Monthly order limit reached — upgrade plan to award more points", { status: 200 });
    }

    const orderTotal = parseFloat(order.total_price);
    const basePoints = calculatePoints(orderTotal, settings);

    if (basePoints <= 0) {
      return new Response("No points to award", { status: 200 });
    }

    const customerId = `gid://shopify/Customer/${order.customer.id}`;
    const customerName = [order.customer.first_name, order.customer.last_name]
      .filter(Boolean)
      .join(" ");

    // Apply VIP tier multiplier
    const lifetimeBefore = await getCustomerPointsBalance(shop, customerId);
    const tierBefore = settings.tiersEnabled ? resolveCustomerTier(lifetimeBefore, tiers) : null;
    const pointsToAward = settings.tiersEnabled ? applyTierMultiplier(basePoints, tierBefore) : basePoints;
    const tierLabel = tierBefore ? ` (${tierBefore.name} tier ${tierBefore.multiplier}x)` : "";

    await awardPoints({
      shop,
      customerId,
      customerEmail: order.customer.email,
      customerName,
      points: pointsToAward,
      type: "EARNED_ONLINE",
      orderId: String(order.id),
      note: `Order #${order.id} — ${formatMoney(orderTotal, settings.currency)} spent${tierLabel}`,
      admin,
    });

    // Evaluate bonus rules (e.g. FIRST_PURCHASE)
    const { bonusPoints, appliedRules } = await evaluateOrderRules({
      shop,
      customerId,
      rules,
      basePoints,
    });

    if (bonusPoints > 0 && appliedRules.length > 0) {
      await awardPoints({
        shop,
        customerId,
        customerEmail: order.customer.email,
        customerName,
        points: bonusPoints,
        type: "EARNED_RULE",
        orderId: String(order.id),
        note: `Bonus: ${appliedRules.join(", ")}`,
        admin,
      });
    }

    // Send points earned email
    if (settings.emailEnabled) {
      const newBalance = await getCustomerPointsBalance(shop, customerId);
      const { subject, bodyHtml } = pointsEarnedEmail({
        customerName,
        points: pointsToAward + bonusPoints,
        orderAmount: formatMoney(orderTotal, settings.currency),
        balance: newBalance,
        fromName: settings.emailFromName,
      });
      await sendEmail(admin, { to: order.customer.email, customerName, subject, bodyHtml, fromName: settings.emailFromName }).catch(() => {});

      // Check if customer just crossed into a new tier
      if (settings.tiersEnabled && tiers.length > 0) {
        const newBalance2 = await getCustomerPointsBalance(shop, customerId);
        const tierAfter = resolveCustomerTier(newBalance2, tiers);
        if (tierAfter && (!tierBefore || tierAfter.id !== tierBefore.id)) {
          const { subject: ts, bodyHtml: tb } = tierUpgradeEmail({
            customerName,
            tierName: tierAfter.name,
            tierColor: tierAfter.color,
            multiplier: tierAfter.multiplier,
            perks: tierAfter.perks,
            fromName: settings.emailFromName,
          });
          await sendEmail(admin, { to: order.customer.email, customerName, subject: ts, bodyHtml: tb, fromName: settings.emailFromName }).catch(() => {});
        }
      }
    }

    console.log(`Awarded ${pointsToAward + bonusPoints} points to ${order.customer.email} for order ${order.id}`);
  } catch (err) {
    console.error("Error processing order points:", err);
  }

  return new Response("OK", { status: 200 });
};
