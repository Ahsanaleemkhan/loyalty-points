/**
 * AI Chat endpoint — called from the storefront loyalty widget.
 * Fetches live customer context, then sends to Claude via Anthropic SDK.
 * No Shopify admin auth needed — public endpoint secured by shop+customer validation.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../db.server";
import { getCustomerPointsBalance, getTransactions } from "../models/transactions.server";
import { getTiers, resolveCustomerTier } from "../models/tiers.server";
import { getSettings } from "../models/settings.server";
import { hasFeatureAccess, type FeatureKey } from "../utils/plan-limits.server";
import { resolvePlanTier } from "../billing/plans";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── Simple in-memory rate limiter: 15 msgs / hour / customer ─────────────────
const _rl = new Map<string, { count: number; resetAt: number }>();
function rateLimitOk(key: string): boolean {
  const now = Date.now();
  const entry = _rl.get(key);
  if (!entry || now > entry.resetAt) {
    _rl.set(key, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 15) return false;
  entry.count++;
  return true;
}

// OPTIONS preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return json({ error: "Method not allowed" }, 405);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const {
    shop,
    customerId,
    customerEmail = "",
    customerName  = "Customer",
    message,
    history = [],
  } = body as {
    shop:          string;
    customerId:    string;
    customerEmail?: string;
    customerName?:  string;
    message:       string;
    history?:      { role: "user" | "assistant"; content: string }[];
  };

  if (!shop || !customerId || !message?.trim()) {
    return json({ error: "Missing required fields: shop, customerId, message" }, 400);
  }

  // Plan gate — AI chatbot requires Growth or Pro plan
  const shopSettings = await prisma.appSettings.findUnique({ where: { shop }, select: { planTier: true } });
  const tier = resolvePlanTier(shopSettings?.planTier ?? null);
  if (!hasFeatureAccess(tier, "aiChatbot")) {
    return json({ error: "AI chat is not available on your current plan. Upgrade to Growth or Pro to unlock it." }, 403);
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  if (!rateLimitOk(`${shop}:${customerId}`)) {
    return json({ error: "You've sent too many messages. Please wait a moment." }, 429);
  }

  // ── Verify shop is installed ──────────────────────────────────────────────
  const session = await prisma.session.findFirst({ where: { shop } });
  if (!session) return json({ error: "Unknown shop." }, 403);

  // ── Check API key + admin settings ───────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "AI chat is not configured on this server." }, 503);

  const adminSettings = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
  if (adminSettings && !adminSettings.chatbotEnabled) {
    return json({ error: "AI chat is currently disabled." }, 503);
  }

  // ── Normalise customer ID ─────────────────────────────────────────────────
  const normalId = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  // ── Fetch live customer context ───────────────────────────────────────────
  const [balance, settings, tiers, recentTxs] = await Promise.all([
    getCustomerPointsBalance(shop, normalId),
    getSettings(shop),
    getTiers(shop),
    getTransactions(shop, normalId).then((txs) => txs.slice(0, 5)),
  ]);

  const currentTier = settings.tiersEnabled ? resolveCustomerTier(balance, tiers) : null;
  const sortedTiers = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  const nextTier    = currentTier
    ? sortedTiers.find((t) => t.minPoints > currentTier.minPoints)
    : sortedTiers[0];
  const pointsToNext = nextTier ? Math.max(0, nextTier.minPoints - balance) : 0;

  const txSummary = recentTxs.length > 0
    ? recentTxs.map((t) => `${t.points > 0 ? "+" : ""}${t.points} pts (${t.note || t.type})`).join(", ")
    : "No recent transactions";

  // ── Build system prompt ───────────────────────────────────────────────────
  const basePrompt = adminSettings?.chatbotSystemPrompt?.trim() ||
    "You are a friendly loyalty rewards assistant. Help customers understand their rewards. Keep responses brief (2-3 sentences).";

  const systemPrompt = `${basePrompt}

--- LIVE CUSTOMER DATA (use this for personalised answers) ---
Name: ${customerName}
Points Balance: ${balance.toLocaleString()} points
Current Tier: ${currentTier ? `${currentTier.name} (${currentTier.multiplier}x multiplier)` : "No tier / base level"}
Next Tier: ${nextTier ? `${nextTier.name} — need ${pointsToNext.toLocaleString()} more points` : "Already at the highest tier! 🎉"}
Earning Rate: ${settings.pointsPerAmount} points per ${settings.amountPerPoints} ${settings.currency} spent
Redemption: ${settings.redemptionEnabled
  ? `${settings.pointsPerDiscount} points = ${settings.discountValue} ${settings.currency} discount (minimum: ${settings.minPointsRedeem} pts)`
  : "Currently disabled"}
Recent Activity: ${txSummary}
---`;

  // ── Call Claude ───────────────────────────────────────────────────────────
  const model = adminSettings?.claudeModel || "claude-sonnet-4-5";

  // Keep last 8 exchanges to avoid large context costs
  const msgHistory = (history as { role: "user" | "assistant"; content: string }[]).slice(-8);

  try {
    const anthropic = new Anthropic({ apiKey });
    const response  = await anthropic.messages.create({
      model,
      max_tokens: 350,
      system:     systemPrompt,
      messages: [
        ...msgHistory,
        { role: "user", content: message.trim() },
      ],
    });

    const reply =
      response.content[0]?.type === "text"
        ? response.content[0].text
        : "Sorry, I couldn't generate a response. Please try again.";

    return json({ reply });
  } catch (err: unknown) {
    console.error("[api/chat] Anthropic error:", err);
    return json({ error: "AI service temporarily unavailable. Please try again." }, 503);
  }
};
