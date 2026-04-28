/**
 * Admin AI Chat endpoint — powers the floating help bubble inside the
 * Shopify embedded admin app. Answers questions about app features and setup.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../db.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Simple rate limiter: 30 msgs / hour / shop
const _rl = new Map<string, { count: number; resetAt: number }>();
function rateLimitOk(shop: string): boolean {
  const now = Date.now();
  const entry = _rl.get(shop);
  if (!entry || now > entry.resetAt) {
    _rl.set(shop, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

export const loader = async (_: LoaderFunctionArgs) => json({ ok: true });

export const action = async ({ request }: ActionFunctionArgs) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { shop, message, history = [] } = body as {
    shop: string;
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!shop || !message?.toString().trim()) {
    return json({ error: "Missing shop or message" }, 400);
  }

  // Verify shop is installed
  const session = await prisma.session.findFirst({ where: { shop } });
  if (!session) return json({ error: "Unauthorized" }, 403);

  if (!rateLimitOk(shop)) {
    return json({ error: "Too many messages. Please wait a moment." }, 429);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "AI assistant is not configured." }, 503);

  // Fetch current app settings for context
  const settings = await prisma.appSettings.findUnique({ where: { shop } }).catch(() => null);

  const systemPrompt = `You are a friendly, concise support assistant for the "Customer Loyalty Points" Shopify app.
You help merchants (store owners) understand and configure the app.

APP OVERVIEW:
- Customers earn points for purchases (configurable rate)
- Points can be redeemed for discount codes
- Features: VIP tiers, referral program, birthday rewards, physical receipt submissions, AI chat for customers, multi-store sync, analytics

CURRENT STORE SETTINGS:
- Points per spend: ${settings?.pointsPerAmount ?? "?"} points per ${settings?.amountPerPoints ?? "?"} ${settings?.currency ?? "USD"}
- Plan: ${settings?.planTier ?? "Free"}
- VIP Tiers: ${settings?.tiersEnabled ? "Enabled" : "Disabled"}
- Redemption: ${settings?.redemptionEnabled ? `Enabled (${settings.pointsPerDiscount} pts = ${settings.discountValue} ${settings.currency ?? "USD"})` : "Disabled"}
- Widget: ${settings?.widgetPosition ?? "bottom-right"}

NAVIGATION GUIDE:
- Dashboard → overview, stats, quick actions
- Customers → view/edit individual customer points
- Submissions → approve physical receipt submissions
- Program → VIP tiers, earning rules, referrals
- Analytics → charts, reports, trends
- Tools → widget builder, store sync, order sync
- Settings → points config, redemption, email, widget appearance
- Billing → upgrade/downgrade plan

Keep answers short (2-4 sentences). Be friendly and practical.`;

  const msgHistory = (history as { role: "user" | "assistant"; content: string }[]).slice(-10);

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: systemPrompt,
      messages: [
        ...msgHistory,
        { role: "user", content: message.toString().trim() },
      ],
    });

    const reply =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : "Sorry, I couldn't generate a response. Please try again.";

    return json({ reply });
  } catch (err) {
    console.error("[api/admin-chat] error:", err);
    return json({ error: "AI service temporarily unavailable." }, 503);
  }
};
