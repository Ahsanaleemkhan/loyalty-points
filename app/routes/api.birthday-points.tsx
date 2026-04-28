/**
 * GET /api/birthday-points?secret=...
 * Run daily via cron. Awards birthday bonus points to customers whose birthday is today.
 *
 * Birthday is stored as a Shopify customer metafield: loyalty.birthday (value: "MM-DD")
 * The cron queries all customers with a birthday matching today's MM-DD.
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getEnabledRules } from "../models/earningRules.server";
import { syncPointsToMetafield } from "../models/points.server";
import { sendEmail } from "../utils/email.server";
import shopify from "../shopify.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function todayMMDD(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url    = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const today = todayMMDD();
  const results: { shop: string; awarded: number }[] = [];

  const shops = await prisma.appSettings.findMany({ where: { isEnabled: true } });

  for (const settings of shops) {
    const rules = await getEnabledRules(settings.shop);
    const birthdayRule = rules.find((r) => r.type === "BIRTHDAY");
    if (!birthdayRule) continue;

    let adminObj: { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> } | null = null;
    try {
      const { admin } = await shopify.unauthenticated.admin(settings.shop);
      adminObj = admin;
    } catch { continue; }

    // Query Shopify for customers with birthday metafield = today
    const gql = `#graphql
      query getBirthdayCustomers($query: String!) {
        customers(first: 50, query: $query) {
          edges {
            node {
              id
              email
              firstName
              lastName
              metafield(namespace: "loyalty", key: "birthday") {
                value
              }
            }
          }
        }
      }`;

    let awarded = 0;
    try {
      const res  = await adminObj.graphql(gql, { variables: { query: `metafield:loyalty.birthday:${today}` } });
      const data = await res.json() as { data?: { customers?: { edges: { node: { id: string; email: string; firstName?: string; lastName?: string; metafield?: { value: string } | null } }[] } } };
      const customers = data.data?.customers?.edges ?? [];

      for (const { node: c } of customers) {
        // Check we haven't already awarded birthday points this year
        const thisYear    = new Date().getFullYear();
        const yearStart   = new Date(`${thisYear}-01-01`);
        const alreadyGiven = await prisma.pointsTransaction.count({
          where: {
            shop: settings.shop, customerId: c.id,
            type: "EARNED_RULE", note: { contains: "birthday" },
            createdAt: { gte: yearStart },
          },
        });
        if (alreadyGiven > 0) continue;

        const customerName = [c.firstName, c.lastName].filter(Boolean).join(" ");

        await prisma.pointsTransaction.create({
          data: {
            shop: settings.shop,
            customerId:    c.id,
            customerEmail: c.email,
            customerName,
            points: birthdayRule.points,
            type:   "EARNED_RULE",
            note:   `🎂 Birthday bonus — happy birthday ${c.firstName ?? ""}!`,
          },
        });

        // Sync metafield
        const balResult = await prisma.pointsTransaction.aggregate({
          where: { shop: settings.shop, customerId: c.id },
          _sum: { points: true },
        });
        const newBalance = balResult._sum.points ?? 0;
        await syncPointsToMetafield(c.id, newBalance, adminObj).catch(() => {});

        // Send birthday email
        if (settings.emailEnabled) {
          await sendEmail(adminObj, {
            to: c.email, customerName,
            subject: `🎂 Happy Birthday ${c.firstName ?? ""}! Here are ${birthdayRule.points} bonus points`,
            bodyHtml: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:28px 32px;text-align:center;">
    <div style="font-size:52px;margin-bottom:8px;">🎂</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">Happy Birthday!</h1>
  </div>
  <div style="padding:28px 32px;text-align:center;">
    <p>Hi ${customerName || "there"},</p>
    <p>To celebrate your special day, we've added <strong>${birthdayRule.points} bonus points</strong> to your loyalty account!</p>
    <div style="background:#ede9fe;border-radius:8px;padding:20px;margin:20px 0;">
      <div style="font-size:40px;font-weight:900;color:#6d28d9;">+${birthdayRule.points}</div>
      <div style="font-size:14px;color:#6d28d9;margin-top:4px;font-weight:600;">Birthday Bonus Points</div>
      <div style="font-size:13px;color:#6d7175;margin-top:8px;">New Balance: ${newBalance.toLocaleString()} pts</div>
    </div>
    <p>Visit our store to redeem your points for a discount. Have a wonderful birthday!</p>
  </div>
</div></body></html>`,
            fromName: settings.emailFromName,
          }).catch(() => {});
        }

        awarded++;
      }
    } catch (err) {
      console.error(`Birthday cron error for ${settings.shop}:`, err);
    }

    results.push({ shop: settings.shop, awarded });
  }

  return json({ success: true, processed: results, today });
};
