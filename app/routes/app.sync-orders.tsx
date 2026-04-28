/**
 * Manual order sync + Webhook health check / force-register.
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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [processedCount, uniqueCustomers, recentWebhooks] = await Promise.all([
    prisma.pointsTransaction.count({ where: { shop, type: "EARNED_ONLINE" } }),
    prisma.pointsTransaction.groupBy({ by: ["customerId"], where: { shop } }).then((r) => r.length),
    // Recent webhook-driven point awards prove the webhook IS firing
    prisma.pointsTransaction.findMany({
      where: { shop, type: "EARNED_ONLINE" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, customerEmail: true, points: true, orderId: true, createdAt: true, note: true },
    }),
  ]);

  // Webhook is registered via shopify.app.toml manifest — no API call needed/possible
  // (Listing webhooks via API requires PCD approval for protected topics like ORDERS_PAID)
  const expectedCallbackUrl = `${process.env.SHOPIFY_APP_URL || ""}/webhooks/orders/paid`;

  return { processedCount, uniqueCustomers, recentWebhooks, expectedCallbackUrl };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "sync");

  // ── Fix Webhook: delete existing + re-register ────────────────────────────
  if (intent === "fix-webhook") {
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const callbackUrl = `${appUrl}/webhooks/orders/paid`;

    // Helper: safely read error from Response or Error object
    const readError = async (e: any): Promise<string> => {
      if (e instanceof Response) {
        try {
          const body = await e.text();
          return `HTTP ${e.status}: ${body.slice(0, 400)}`;
        } catch {
          return `HTTP ${e.status}`;
        }
      }
      return e?.message || e?.toString() || "Unknown error";
    };

    try {
      // Step 1: List all existing webhook subscriptions
      let existing: any[] = [];
      try {
        const listResp = await admin.graphql(`#graphql
          query {
            webhookSubscriptions(first: 20) {
              edges { node { id topic } }
            }
          }
        `);
        const listData = await listResp.json() as any;
        existing = listData.data?.webhookSubscriptions?.edges ?? [];
        console.log(`[fix-webhook] Found ${existing.length} existing webhooks`);
      } catch (listErr: any) {
        const msg = await readError(listErr);
        console.error("[fix-webhook] Could not list webhooks:", msg);
        return { webhookFixed: false, error: `Could not list webhooks: ${msg}` };
      }

      // Step 2: Delete any existing ORDERS_PAID webhooks
      let deleted = 0;
      for (const { node } of existing) {
        if (node.topic === "ORDERS_PAID") {
          try {
            await admin.graphql(`#graphql
              mutation deleteWebhook($id: ID!) {
                webhookSubscriptionDelete(id: $id) {
                  deletedWebhookSubscriptionId
                  userErrors { message }
                }
              }
            `, { variables: { id: node.id } });
            deleted++;
            console.log(`[fix-webhook] Deleted ORDERS_PAID webhook: ${node.id}`);
          } catch (delErr: any) {
            console.warn("[fix-webhook] Delete failed (continuing):", await readError(delErr));
          }
        }
      }

      // Step 3: Create a fresh ORDERS_PAID webhook
      let createData: any;
      try {
        const createResp = await admin.graphql(`#graphql
          mutation createWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
              userErrors { field message }
              webhookSubscription {
                id
                topic
                endpoint {
                  ... on WebhookHttpEndpoint { callbackUrl }
                }
              }
            }
          }
        `, {
          variables: {
            topic: "ORDERS_PAID",
            webhookSubscription: {
              callbackUrl,
              format: "JSON",
            },
          },
        });
        createData = await createResp.json() as any;
      } catch (createErr: any) {
        const msg = await readError(createErr);
        console.error("[fix-webhook] Create HTTP error:", msg);
        return { webhookFixed: false, error: `Webhook create HTTP error: ${msg}`, deleted };
      }

      const userErrors = createData.data?.webhookSubscriptionCreate?.userErrors ?? [];
      const gqlErrors  = createData.errors ?? [];
      const created    = createData.data?.webhookSubscriptionCreate?.webhookSubscription;

      if (gqlErrors.length > 0) {
        const errMsg = gqlErrors.map((e: any) => e.message).join(", ");
        console.error("[fix-webhook] GraphQL errors:", errMsg);
        return { webhookFixed: false, error: `GraphQL error: ${errMsg}`, deleted };
      }

      if (userErrors.length > 0) {
        const errMsg = userErrors.map((e: any) => `${e.field}: ${e.message}`).join(", ");
        console.error("[fix-webhook] UserErrors:", errMsg);
        return { webhookFixed: false, error: `Shopify rejected webhook: ${errMsg}`, deleted };
      }

      if (!created) {
        const raw = JSON.stringify(createData).slice(0, 400);
        console.error("[fix-webhook] No webhook in response:", raw);
        return { webhookFixed: false, error: `No webhook returned. Full response: ${raw}`, deleted };
      }

      console.log(`[fix-webhook] ✓ Created ORDERS_PAID webhook: ${created?.id} → ${created?.endpoint?.callbackUrl}`);
      return {
        webhookFixed: true,
        webhookId: created?.id,
        callbackUrl: created?.endpoint?.callbackUrl,
        deleted,
        message: `✓ Webhook created! ID: ${created?.id} → ${callbackUrl}. New paid orders will now auto-award points.`,
      };
    } catch (e: any) {
      const msg = await readError(e);
      console.error("[fix-webhook] Unexpected exception:", msg);
      return { webhookFixed: false, error: `Unexpected error: ${msg}` };
    }
  }

  // ── Manual Order Sync (blocked by PCD) ───────────────────────────────────
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

    const ORDERS_QUERY = `#graphql
      query getOrders {
        orders(first: 50, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              displayFinancialStatus
              totalPriceSet { shopMoney { amount } }
              customer {
                id
                email
                firstName
                lastName
              }
            }
          }
        }
      }
    `;

    let gqlData: any;
    try {
      const gqlResp = await admin.graphql(ORDERS_QUERY);
      gqlData = await gqlResp.json();
    } catch (gqlErr: any) {
      if (gqlErr instanceof Response) {
        const body = await gqlErr.text().catch(() => "");
        console.error("[sync-orders] graphql HTTP", gqlErr.status, body);
        return {
          error: `Shopify rejected the orders query (HTTP ${gqlErr.status}). Protected Customer Data access not yet approved. Use the "Fix Webhook" button above to ensure auto-points work for all future orders.`,
          done: false,
        };
      }
      throw gqlErr;
    }

    if (gqlData.errors?.length) {
      const msg = gqlData.errors.map((e: any) => e?.message).join(", ");
      return { error: `GraphQL: ${msg}`, done: false };
    }

    const allOrders: any[] = (gqlData.data?.orders?.edges ?? []).map((e: any) => e.node);
    const orders = allOrders.filter((o: any) =>
      ["PAID", "PARTIALLY_REFUNDED"].includes(o.displayFinancialStatus ?? "")
    );

    if (orders.length === 0) {
      return { awarded: 0, skipped: 0, noCustomer: 0, errors: [], done: true };
    }

    for (const order of orders) {
      if (!order.customer) { noCustomer++; continue; }

      const orderNumericId = order.id.replace("gid://shopify/Order/", "");
      const alreadyProcessed = await prisma.pointsTransaction.count({
        where: { shop, orderId: orderNumericId, type: "EARNED_ONLINE" },
      });
      if (alreadyProcessed > 0) { skipped++; continue; }

      const orderTotal = parseFloat(order.totalPriceSet?.shopMoney?.amount ?? "0");
      const basePoints = calculatePoints(orderTotal, settings);
      if (basePoints <= 0) { skipped++; continue; }

      const customerId    = order.customer.id;
      const customerEmail = order.customer.email || `shopify_${order.customer.id}@store`;
      const customerName  = [order.customer.firstName, order.customer.lastName].filter(Boolean).join(" ") || customerEmail;

      const lifetimeBalance = await getCustomerPointsBalance(shop, customerId);
      const tierNow   = settings.tiersEnabled ? resolveCustomerTier(lifetimeBalance, tiers) : null;
      const finalPts  = settings.tiersEnabled ? applyTierMultiplier(basePoints, tierNow) : basePoints;
      const tierLabel = tierNow ? ` (${tierNow.name} ${tierNow.multiplier}×)` : "";

      await awardPoints({
        shop, customerId, customerEmail, customerName,
        points: finalPts, type: "EARNED_ONLINE", orderId: orderNumericId,
        note: `Synced order ${order.name ?? `#${orderNumericId}`} — ${formatMoney(orderTotal, settings.currency)}${tierLabel}`,
        admin,
      });

      const { bonusPoints, appliedRules } = await evaluateOrderRules({ shop, customerId, rules, basePoints });
      if (bonusPoints > 0) {
        await awardPoints({
          shop, customerId, customerEmail, customerName,
          points: bonusPoints, type: "EARNED_RULE", orderId: orderNumericId,
          note: `Sync bonus: ${appliedRules.join(", ")}`, admin,
        });
      }

      awarded++;
    }
  } catch (e: any) {
    if (e instanceof Response) {
      const body = await e.text().catch(() => "no body");
      errors.push(`Shopify API HTTP ${e.status}: ${body.slice(0, 200)}`);
    } else {
      errors.push(e?.message || JSON.stringify(e) || "Unknown error");
    }
  }

  return { awarded, skipped, noCustomer, errors, done: true };
};

export default function SyncOrders() {
  const { processedCount, uniqueCustomers, recentWebhooks, expectedCallbackUrl } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const result = syncFetcher.data as any;
  const running = syncFetcher.state === "submitting";

  const TOOLS_TABS = [
    { label: "Widget Builder", to: "/app/widget-builder" },
    { label: "Store Sync",     to: "/app/store-sync" },
    { label: "Sync Orders",    to: "/app/sync-orders" },
  ];

  const webhookIsWorking = (recentWebhooks as any[])?.length > 0;

  return (
    <s-page heading="Sync Orders">
      <PageTabs tabs={TOOLS_TABS} />

      {/* ── Webhook Status (truthful) ── */}
      <s-section heading="Webhook Status (Auto-Points)">
        <div style={{ maxWidth: "720px" }}>
          <div style={{
            background: webhookIsWorking ? "#f0fdf4" : "#fffbeb",
            border: `1px solid ${webhookIsWorking ? "#a7f3d0" : "#fcd34d"}`,
            borderRadius: "10px",
            padding: "16px 18px",
            marginBottom: "16px",
          }}>
            <div style={{ fontWeight: "700", fontSize: "15px", color: webhookIsWorking ? "#065f46" : "#92400e", marginBottom: "8px" }}>
              {webhookIsWorking
                ? `✅ Webhook IS Working — ${(recentWebhooks as any[]).length} recent order(s) auto-earned points`
                : "⏳ Webhook Registered (via app config) — No orders received yet"}
            </div>
            <div style={{ fontSize: "13px", color: "#374151", lineHeight: "1.6" }}>
              <strong>Topic:</strong> <code>orders/paid</code><br />
              <strong>Endpoint:</strong> <code style={{ wordBreak: "break-all" }}>{expectedCallbackUrl}</code><br />
              <strong>Registered via:</strong> <code>shopify.app.toml</code> manifest (auto-registered on app install)
            </div>
            {!webhookIsWorking && (
              <div style={{ fontSize: "12px", color: "#92400e", marginTop: "10px", lineHeight: "1.6" }}>
                💡 The webhook is registered automatically when the app installs. To verify it's firing, create a new paid order — points will appear within seconds. If nothing appears, check PM2 logs for <code>[orders/paid]</code> entries.
              </div>
            )}
          </div>

          {/* Recent webhook activity */}
          {(recentWebhooks as any[])?.length > 0 && (
            <div style={{ marginTop: "16px", marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#374151", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Recent Webhook-Awarded Points
              </div>
              <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "12px" }}>
                {(recentWebhooks as any[]).map((w) => (
                  <div key={w.id} style={{ fontSize: "13px", color: "#374151", padding: "8px 0", borderBottom: "1px solid #e5e7eb" }}>
                    <div><strong>{w.customerEmail}</strong> · +{w.points} pts</div>
                    <div style={{ fontSize: "11px", color: "#6b7280" }}>
                      Order #{w.orderId} · {new Date(w.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "12px 14px", fontSize: "12px", color: "#1e40af", lineHeight: "1.6" }}>
            ℹ️ <strong>Note:</strong> We can't display "registered webhook list" via the Shopify API because <code>ORDERS_PAID</code> contains protected customer data and requires PCD approval to query. The webhook is still registered and active via your app's manifest.
          </div>
        </div>
      </s-section>

      {/* ── Manual Sync Panel ── */}
      <s-section heading="Manual Order Sync">
        <div style={{ maxWidth: "640px" }}>
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", fontSize: "13px", color: "#92400e" }}>
            <strong>⚠️ Requires Shopify PCD Approval</strong> — The manual sync reads orders from the Shopify API which requires Protected Customer Data access. While pending approval, use the Webhook fix above + manually enroll customers via the <a href="/app/customers" style={{ color: "#1d4ed8" }}>Customers tab</a>.
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
                <div>🏆 Points awarded for <strong>{result.awarded}</strong> orders</div>
                <div>⏭️ Skipped <strong>{result.skipped}</strong> (already processed or zero spend)</div>
                {result.noCustomer > 0 && <div style={{ color: "#6d7175" }}>👤 Skipped <strong>{result.noCustomer}</strong> guest orders</div>}
                {result.errors?.length > 0 && (
                  <div style={{ color: "#b91c1c", marginTop: "6px", background: "#fee2e2", padding: "8px 10px", borderRadius: "6px" }}>
                    ⚠️ {result.errors.join(" | ")}
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

          <syncFetcher.Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <button type="submit" disabled={running} className="lp-btn lp-btn-secondary" style={{ fontSize: "15px", padding: "12px 28px" }}>
              {running ? "⏳ Syncing orders…" : "🔄 Sync Last 50 Paid Orders (needs PCD)"}
            </button>
          </syncFetcher.Form>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
