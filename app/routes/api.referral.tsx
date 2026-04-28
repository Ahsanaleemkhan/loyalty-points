/**
 * Public API for referral code management.
 * GET  /api/referral?customerId=...&shop=...  — fetch or create referral code
 * POST /api/referral                           — convert a referral code
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getOrCreateReferralCode, getReferralByCode, convertReferral } from "../models/referrals.server";
import { getEnabledRules } from "../models/earningRules.server";
import { awardPoints } from "../models/points.server";
import { getSettings } from "../models/settings.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const customerEmail = url.searchParams.get("customerEmail");
  const customerName = url.searchParams.get("customerName") || "";
  const shop = url.searchParams.get("shop");

  if (!customerId || !customerEmail || !shop) {
    return json({ error: "Missing required params" }, 400);
  }

  try {
    const code = await getOrCreateReferralCode({ shop, customerId, customerEmail, customerName });
    const referral = await getReferralByCode(code);
    return json({ code, status: referral?.status ?? "PENDING", converted: referral?.status === "CONVERTED" });
  } catch (err) {
    console.error("Referral loader error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await request.json() as {
      referralCode?: string;
      referredId?: string;
      referredEmail?: string;
      shop?: string;
    };

    const { referralCode, referredId, referredEmail, shop } = body;

    if (!referralCode || !referredId || !referredEmail || !shop) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Get the referral
    const referral = await getReferralByCode(referralCode);
    if (!referral) return json({ error: "Invalid referral code" }, 404);
    if (referral.shop !== shop) return json({ error: "Invalid referral code" }, 404);

    // Prevent self-referral
    if (referral.referrerId === referredId) {
      return json({ error: "Cannot use your own referral code" }, 400);
    }

    const { referral: updated, alreadyConverted } = await convertReferral({
      referralCode,
      referredId,
      referredEmail,
    });

    if (alreadyConverted) {
      return json({ success: false, message: "Referral already converted" });
    }

    // Award points to referrer if a REFERRAL earning rule exists
    const [rules, settings, session] = await Promise.all([
      getEnabledRules(shop),
      getSettings(shop),
      prisma.session.findFirst({ where: { shop, isOnline: false } }),
    ]);

    if (!session) {
      return json({ success: true, message: "Referral converted (no session for points)" });
    }

    // Minimal admin-like object using the offline session
    // Note: For full GraphQL we'd need the full admin object; here we award via DB only
    const referralRule = rules.find((r) => r.type === "REFERRAL");
    const referralPoints = referralRule ? referralRule.points : 0;

    if (referralPoints > 0 && settings.isEnabled) {
      // Award points to referrer
      await prisma.pointsTransaction.create({
        data: {
          shop,
          customerId: referral!.referrerId,
          customerEmail: referral!.referrerEmail,
          customerName: referral!.referrerName,
          points: referralPoints,
          type: "EARNED_RULE",
          note: `Referral bonus — ${referredEmail} made their first purchase`,
        },
      });

      // Update referral record with points awarded
      await prisma.referral.update({
        where: { referralCode },
        data: { pointsAwarded: referralPoints },
      });
    }

    return json({ success: true, message: "Referral converted", pointsAwarded: referralPoints });
  } catch (err) {
    console.error("Referral action error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
