/**
 * GET /api/expire-points?secret=...
 * Run daily via cron. Two jobs in one:
 *  1. Send 7-day advance expiry warning emails
 *  2. Actually expire points that have passed their expiry date
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { syncPointsToMetafield } from "../models/points.server";
import { sendEmail } from "../utils/email.server";
import shopify from "../shopify.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Build expiry warning email */
function expiryWarningEmail(params: { customerName: string; points: number; daysLeft: number; fromName: string }) {
  const { customerName, points, daysLeft, fromName } = params;
  const subject = `⏰ Your ${points.toLocaleString()} points expire in ${daysLeft} days!`;
  const bodyHtml = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="background:#d97706;padding:24px 32px;"><h1 style="margin:0;color:#fff;font-size:20px;">⏰ Points Expiring Soon</h1></div>
  <div style="padding:28px 32px;">
    <p>Hi ${customerName || "there"},</p>
    <p>This is a friendly reminder that your loyalty points are expiring soon.</p>
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <div style="font-size:36px;font-weight:800;color:#92400e;">${points.toLocaleString()}</div>
      <div style="font-size:14px;color:#92400e;margin-top:4px;">points expire in <strong>${daysLeft} days</strong></div>
    </div>
    <p>Don't let your hard-earned points go to waste! Redeem them in our loyalty widget for an instant discount.</p>
    <p style="font-size:13px;color:#6d7175;">To redeem, visit our store and open the Loyalty Widget in the storefront.</p>
  </div>
  <div style="padding:14px 32px;background:#f6f6f7;font-size:12px;color:#6d7175;text-align:center;">
    You are receiving this because you have a loyalty account with ${fromName}.
  </div>
</div></body></html>`;
  return { subject, bodyHtml };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const results: { shop: string; expired: number; warned: number; customers: number }[] = [];

  const shopsWithExpiry = await prisma.appSettings.findMany({
    where: { pointsExpiryDays: { gt: 0 }, isEnabled: true },
  });

  for (const settings of shopsWithExpiry) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - settings.pointsExpiryDays);

    // 7-day warning cutoff: points earned between (expiryDays-7) and expiryDays days ago
    const warnCutoffStart = new Date();
    warnCutoffStart.setDate(warnCutoffStart.getDate() - settings.pointsExpiryDays + 7);
    const warnCutoffEnd = new Date();
    warnCutoffEnd.setDate(warnCutoffEnd.getDate() - settings.pointsExpiryDays + 8);

    const earnedTransactions = await prisma.pointsTransaction.findMany({
      where: {
        shop: settings.shop,
        type: { in: ["EARNED_ONLINE", "EARNED_PHYSICAL", "EARNED_RULE", "MANUAL_ADJUST"] },
        createdAt: { lt: cutoffDate },
        points: { gt: 0 },
      },
      select: { customerId: true, customerEmail: true, customerName: true },
      distinct: ["customerId"],
    });

    let expiredCount = 0;
    let warnedCount  = 0;

    // Get admin for email sending
    let adminObj: { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> } | null = null;
    try {
      const { admin } = await shopify.unauthenticated.admin(settings.shop);
      adminObj = admin;
    } catch (e) {
      console.error(`Could not get admin for ${settings.shop}:`, e);
    }

    for (const customer of earnedTransactions) {
      const [earnedBefore, alreadyExpired] = await Promise.all([
        prisma.pointsTransaction.aggregate({
          where: {
            shop: settings.shop, customerId: customer.customerId,
            type: { in: ["EARNED_ONLINE", "EARNED_PHYSICAL", "EARNED_RULE", "MANUAL_ADJUST"] },
            createdAt: { lt: cutoffDate },
            points: { gt: 0 },
          },
          _sum: { points: true },
        }),
        prisma.pointsTransaction.aggregate({
          where: { shop: settings.shop, customerId: customer.customerId, type: "EXPIRED" },
          _sum: { points: true },
        }),
      ]);

      const pointsToExpire = (earnedBefore._sum.points ?? 0) + (alreadyExpired._sum.points ?? 0);
      if (pointsToExpire <= 0) continue;

      const balanceResult = await prisma.pointsTransaction.aggregate({
        where: { shop: settings.shop, customerId: customer.customerId },
        _sum: { points: true },
      });
      const balance  = balanceResult._sum.points ?? 0;
      const toExpire = Math.min(pointsToExpire, balance);
      if (toExpire <= 0) continue;

      // Expire
      await prisma.pointsTransaction.create({
        data: {
          shop: settings.shop, customerId: customer.customerId,
          customerEmail: customer.customerEmail, customerName: customer.customerName,
          points: -toExpire, type: "EXPIRED",
          note: `Points expired after ${settings.pointsExpiryDays} days`,
        },
      });
      expiredCount++;

      try {
        if (adminObj) await syncPointsToMetafield(customer.customerId, balance - toExpire, adminObj);
      } catch (e) {
        console.error(`Metafield sync failed for ${customer.customerId}:`, e);
      }
    }

    // ── 7-day warning emails ──────────────────────────
    if (settings.emailEnabled && adminObj) {
      // Find customers with points that will expire in exactly 7 days
      const soonExpiring = await prisma.pointsTransaction.findMany({
        where: {
          shop: settings.shop,
          type: { in: ["EARNED_ONLINE", "EARNED_PHYSICAL", "EARNED_RULE"] },
          points: { gt: 0 },
          createdAt: { gte: warnCutoffStart, lt: warnCutoffEnd },
        },
        select: { customerId: true, customerEmail: true, customerName: true },
        distinct: ["customerId"],
      });

      for (const c of soonExpiring) {
        // Check they have a positive balance (warning is pointless if balance is 0)
        const bal = await prisma.pointsTransaction.aggregate({
          where: { shop: settings.shop, customerId: c.customerId },
          _sum: { points: true },
        });
        if ((bal._sum.points ?? 0) <= 0) continue;

        // Check we haven't already sent a warning this week
        const alreadyWarned = await prisma.pointsTransaction.count({
          where: {
            shop: settings.shop, customerId: c.customerId,
            type: "MANUAL_ADJUST",
            note: { contains: "expiry warning sent" },
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        });
        if (alreadyWarned > 0) continue;

        const { subject, bodyHtml } = expiryWarningEmail({
          customerName: c.customerName,
          points: bal._sum.points ?? 0,
          daysLeft: 7,
          fromName: settings.emailFromName,
        });

        const sent = await sendEmail(adminObj, {
          to: c.customerEmail,
          customerName: c.customerName,
          subject, bodyHtml,
          fromName: settings.emailFromName,
        }).catch(() => false);

        if (sent) {
          // Record that we sent the warning (using a zero-point note transaction as a log)
          await prisma.pointsTransaction.create({
            data: {
              shop: settings.shop, customerId: c.customerId,
              customerEmail: c.customerEmail, customerName: c.customerName,
              points: 0, type: "MANUAL_ADJUST",
              note: `expiry warning sent — ${bal._sum.points} pts`,
            },
          });
          warnedCount++;
        }
      }
    }

    results.push({ shop: settings.shop, expired: expiredCount, warned: warnedCount, customers: earnedTransactions.length });
  }

  return json({ success: true, processed: results });
};
