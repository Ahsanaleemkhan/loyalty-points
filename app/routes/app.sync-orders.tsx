/**
 * Manual order sync — fetches customers via GraphQL Admin API and awards
 * points based on lifetime spend for any that haven't been fully processed.
 * Used when the ORDERS_PAID webhook is blocked (Protected Customer Data).
 * Uses GraphQL customers query (read_customers scope) — no PCD approval needed.
 */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, calculatePoints } from "../models/settings.server";
import { awardPoints } from "../models/points.server";
import { getTiers, resolveCustomerTier, applyTierMultiplier } from "../models/tiers.server";
import { getCustomerPointsBalance } from "../models/transactions.server";
import { getEnabledRules, evaluateOrderRules } from "../models/earningRules.server";
import { formatMoney } from "../utils/currency";
import { PageTabs } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [processedCount, uniqueCustomers] = await Promise.all([
    prisma.pointsTransaction.count({ where: { shop, type: "EARNED_ONLINE" } }),
    prisma.pointsTransaction.groupBy({ by: ["customerId"], where: { shop } }).then((r) => r.length),
  ]);
  return { processedCount, uniqueCustomers };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let awarded = 0;
  let skipped = 0;
  let noCustomer = 0;
  const errors: string[] = [];

  try {
    const [settings, tiers, rules] = await Promise.all([
      getSettings(shop),
      getTiers(shop),
      getEnabledRules(shop),
    ]);

    if (!settings.isEnabled) {
      return { error: "Loyalty program is disabled. Enable it in Settings first." };
    }

    // Use REST API — works with read_orders scope.
    // GraphQL orders query requires read_all_orders (new Shopify policy Apr 2025).
    const restResp = await admin.rest.get({
      path: "orders",
      query: { status: "any", financial_status: "paid", limit: "50" },
    });
    const restData = (await restResp.json()) as any;

    if (!restResp.ok) {
      console.error("[sync-orders] REST error:", restResp.status, JSON.stringify(restData));
      return { error: `Shopify API error ${restResp.status}: ${JSON.stringify(restData)}`, done: false };
    }

    const orders: any[] = restData.orders ?? [];
    console.log("[sync-orders] REST orders fetched:", orders.length);

    if (orders.length === 0) {
      return { awarded: 0, skipped: 0, noCustomer: 0, errors: [], done: true };
    }

    for (const order of orders) {
      if (!order.customer) { noCustomer++; continue; }

      const orderNumericId = String(order.id);

      // Idempotency: skip if already processed
      const alreadyProcessed = await prisma.pointsTransaction.count({
        where: { shop, orderId: orderNumericId, type: "EARNED_ONLINE" },
      });
      if (alreadyProcessed > 0) { skipped++; continue; }

      // REST API fields
      const orderTotal = parseFloat(order.total_price ?? "0");
      const basePoints = calculatePoints(orderTotal, settings);
      if (basePoints <= 0) { skipped++; continue; }

      const customerId    = `gid://shopify/Customer/${order.customer.id}`;
      const customerEmail = order.customer.email || `shopify_${order.customer.id}@store`;
      const customerName  = [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") || customerEmail;

      // Apply VIP tier multiplier
      const lifetimeBalance = await getCustomerPointsBalance(shop, customerId);
      const tierNow   = settings.tiersEnabled ? resolveCustomerTier(lifetimeBalance, tiers) : null;
      const finalPts  = settings.tiersEnabled ? applyTierMultiplier(basePoints, tierNow) : basePoints;
      const tierLabel = tierNow ? ` (${tierNow.name} ${tierNow.multiplier}×)` : "";

      await awardPoints({
        shop,
        customerId,
        customerEmail,
        customerName,
        points: finalPts,
        type: "EARNED_ONLINE",
        orderId: orderNumericId,
        note: `Synced order #${order.order_number ?? orderNumericId} — ${formatMoney(orderTotal, settings.currency)}${tierLabel}`,
        admin,
      });

      // Bonus rules
      const { bonusPoints, appliedRules } = await evaluateOrderRules({ shop, customerId, rules, basePoints });
      if (bonusPoints > 0) {
        await awardPoints({
          shop, customerId, customerEmail, customerName,
          points: bonusPoints, type: "EARNED_RULE",
          orderId: orderNumericId,
          note: `Sync bonus: ${appliedRules.join(", ")}`,
          admin,
        });
      }

      awarded++;
    }
  } catch (e: any) {
    if (e instanceof Response) {
      const body = await e.text().catch(() => "no body");
      console.error("[sync-orders] HTTP error:", e.status, body);
      errors.push(`Shopify API HTTP ${e.status}: ${body.slice(0, 200)}`);
    } else {
      const msg = e?.message || e?.toString() || JSON.stringify(e) || "Unknown error";
      console.error("[sync-orders] caught error:", msg);
      errors.push(msg);
    }
  }

  return { awarded, skipped, noCustomer, errors, done: true };
};

export default function SyncOrders() {
  const { processedCount, uniqueCustomers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data as any;
  const running = fetcher.state === "submitting";

  const TOOLS_TABS = [
    { label: "Widget Builder", to: "/app/widget-builder" },
    { label: "Store Sync",     to: "/app/store-sync" },
    { label: "Sync Orders",    to: "/app/sync-orders" },
  ];

  return (
    <s-page heading="Sync Orders">
      <PageTabs tabs={TOOLS_TABS} />
      <s-section heading="Manual Order Sync">
        <div style={{ maxWidth: "640px" }}>
          <div style={{ background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", fontSize: "13px", color: "#065f46" }}>
            <strong>✓ Works without PCD approval</strong> — uses the GraphQL Customers API (not Orders API) to calculate points from each customer's lifetime spend. Safe to run multiple times.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            <div style={{ background: "#f6f6f7", borderRadius: "10px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Orders Processed</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#008060" }}>{processedCount.toLocaleString()}</div>
            </div>
            <div style={{ background: "#f6f6f7", borderRadius: "10px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Enrolled Customers</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#2563eb" }}>{uniqueCustomers.toLocaleString()}</div>
            </div>
          </div>

          {result?.done && (
            <div style={{ background: result.awarded > 0 ? "#f0fdf4" : "#fffbeb", border: `1px solid ${result.awarded > 0 ? "#a7f3d0" : "#fcd34d"}`, borderRadius: "8px", padding: "14px 16px", marginBottom: "16px" }}>
              <div style={{ fontWeight: "700", color: result.awarded > 0 ? "#065f46" : "#92400e", marginBottom: "8px" }}>
                {result.awarded > 0 ? "✓ Sync Complete" : "⚠️ Sync ran — check details below"}
              </div>
              <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div>🏆 Points awarded for <strong>{result.awarded}</strong> customers</div>
                <div>⏭️ Skipped <strong>{result.skipped}</strong> customers (already up to date or zero spend)</div>
                {result.noCustomer > 0 && (
                  <div style={{ color: "#6d7175" }}>
                    👤 Skipped <strong>{result.noCustomer}</strong> customers with no orders
                  </div>
                )}
                {result.errors?.length > 0 && (
                  <div style={{ color: "#b91c1c", marginTop: "6px", background: "#fee2e2", padding: "8px 10px", borderRadius: "6px" }}>
                    ⚠️ Errors: {result.errors.join(" | ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {result?.error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "14px 16px", marginBottom: "16px", color: "#b91c1c", fontWeight: "600" }}>
              ✕ {result.error}
            </div>
          )}

          <fetcher.Form method="post">
            <button type="submit" disabled={running} className="lp-btn lp-btn-primary" style={{ fontSize: "15px", padding: "12px 28px" }}>
              {running ? "⏳ Syncing orders…" : "🔄 Sync Last 50 Paid Orders"}
            </button>
          </fetcher.Form>

          <div style={{ marginTop: "16px", fontSize: "12px", color: "#9ca3af" }}>
            Scans all customers and awards points based on their lifetime spend. Already-correct balances are skipped. Safe to run multiple times.
          </div>

          <div style={{ marginTop: "24px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "14px 16px" }}>
            <div style={{ fontWeight: "700", color: "#0369a1", marginBottom: "8px" }}>🔔 Get Automatic Points (Permanent Fix)</div>
            <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#374151", lineHeight: "1.8" }}>
              <li>Go to <strong>Shopify Partners Dashboard</strong> → your app → <strong>API access</strong></li>
              <li>Under <strong>"Protected customer data access"</strong>, select the purpose</li>
              <li>Save — webhooks will register automatically on next app load</li>
            </ol>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
