import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PageTabs } from "../components/ui";
import {
  BILLING_PLAN_DETAILS,
  BILLING_PLAN_NAMES,
  isBillingPlanName,
  resolvePlanTier,
} from "../billing/plans";
import { getBillingTestMode } from "../utils/billing-mode.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const isTestMode = await getBillingTestMode();

  let activeSubscription: { id: string; name: string; status: string; currentPeriodEnd?: string } | null = null;

  try {
    const billingCheck = await billing.check({
      plans: [...BILLING_PLAN_NAMES],
      isTest: isTestMode,
    } as any);

    activeSubscription =
      (billingCheck.appSubscriptions as any[]).find(
        (subscription) =>
          subscription.status === "ACTIVE" && isBillingPlanName(subscription.name),
      ) ?? null;
  } catch (e) {
    console.warn("[billing loader] billing.check failed:", (e as Error)?.message);
  }

  const activePlan = activeSubscription ? activeSubscription.name : null;

  const tier = resolvePlanTier(activePlan);
  try {
    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: { planTier: tier },
      create: { shop: session.shop, planTier: tier },
    });
  } catch (e) {
    console.warn("[billing loader] DB sync failed:", (e as Error)?.message);
  }

  const message = new URL(request.url).searchParams.get("message");

  return {
    plans: BILLING_PLAN_NAMES.map((plan) => ({ key: plan, ...BILLING_PLAN_DETAILS[plan] })),
    activePlan,
    activeSubscription,
    message,
    isTestMode,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const isTestMode = await getBillingTestMode();

  // ── Dev bypass: set plan directly in DB without Shopify billing ────────────
  // Used when Shopify billing returns 403 (Partners config issue) or for testing.
  if (intent === "force-activate") {
    const plan = String(formData.get("plan") || "Starter");
    const tier = isBillingPlanName(plan) ? plan : "Starter";
    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: { planTier: tier },
      create: { shop: session.shop, planTier: tier },
    });
    return redirect("/app/billing?message=approved");
  }

  if (intent === "force-deactivate") {
    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: { planTier: "Free" },
      create: { shop: session.shop, planTier: "Free" },
    });
    return redirect("/app/billing?message=cancelled");
  }

  if (intent === "subscribe") {
    const requestedPlan = String(formData.get("plan") || "");
    if (!isBillingPlanName(requestedPlan)) {
      return { error: "Invalid billing plan" };
    }

    // Build return URL — must be an absolute URL back to this app
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const returnUrl = `${appUrl}/app/billing?message=approved&shop=${session.shop}`;

    // billing.request() throws a redirect Response (302 or 200+App Bridge).
    // We catch it, extract the Shopify confirmation URL, and return it as
    // plain JSON so the client can do window.top.location = url — the only
    // reliable way to break out of the Shopify Admin iframe.
    try {
      await (billing as any).request({
        plan: requestedPlan,
        isTest: isTestMode,
        returnUrl,
      });
      // Should not reach here — billing.request always throws
      return { error: "Billing request did not redirect as expected." };
    } catch (thrown: unknown) {
      if (thrown instanceof Response) {
        // ── Case 1: App Bridge response (200 + JSON body) ──────────────────
        if (thrown.status === 200) {
          try {
            const body = await thrown.clone().json() as Record<string, unknown>;
            const confirmationUrl =
              (body.redirectUrl as string) ||
              (body.confirmationUrl as string) ||
              null;
            if (confirmationUrl) {
              console.log("[billing] App Bridge redirect →", confirmationUrl);
              return { confirmationUrl };
            }
          } catch { /* fall through */ }
          // Return the 200 Response directly so App Bridge can handle it
          return thrown;
        }

        // ── Case 2: Plain 302 redirect ─────────────────────────────────────
        if (thrown.status === 302 || thrown.status === 301) {
          const confirmationUrl = thrown.headers.get("location");
          if (confirmationUrl) {
            console.log("[billing] 302 redirect →", confirmationUrl);
            return { confirmationUrl };
          }
        }

        // Unknown Response — log and surface error
        console.error("[billing] Unexpected Response from billing.request:", thrown.status);
        return { error: `Shopify billing error (HTTP ${thrown.status}). Please try again.` };
      }

      // Non-Response error
      const msg = (thrown as Error)?.message ?? String(thrown);
      console.error("[billing] billing.request error:", msg);
      return { error: `Could not start billing: ${msg}` };
    }
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") || "");
    if (!subscriptionId) {
      return { error: "Missing subscription ID" };
    }

    try {
      await billing.cancel({
        subscriptionId,
        isTest: isTestMode,
        prorate: false,
      });
    } catch (e: any) {
      return { error: `Cancel failed: ${e?.message ?? e}` };
    }

    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: { planTier: "Free" },
      create: { shop: session.shop, planTier: "Free" },
    });

    return redirect("/app/billing?message=cancelled");
  }

  return redirect("/app/billing");
};

function getMessageText(message: string | null) {
  if (message === "approved")  return "✅ Billing updated successfully. Your plan is now active!";
  if (message === "cancelled") return "Subscription cancelled. You're back on the Free plan.";
  return null;
}

export default function BillingPage() {
  const { plans, activePlan, activeSubscription, message, isTestMode } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const messageText = getMessageText(message);
  const result = fetcher.data as any;

  // ── Break out of Shopify iframe when server returns a confirmationUrl ──────
  // This is the only reliable approach for embedded apps: the server extracts
  // the Shopify billing URL and the client navigates window.top to it.
  useEffect(() => {
    if (result?.confirmationUrl) {
      console.log("[billing] Redirecting top window →", result.confirmationUrl);
      try {
        (window.top ?? window).location.href = result.confirmationUrl;
      } catch {
        window.location.href = result.confirmationUrl;
      }
    }
  }, [result?.confirmationUrl]);

  const renewalDate = activeSubscription?.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  const SETTINGS_TABS = [
    { label: "Settings", to: "/app/settings" },
    { label: "Billing",  to: "/app/billing" },
  ];

  const isSubmitting = fetcher.state === "submitting";

  return (
    <s-page heading="Billing & Plans">
      <PageTabs tabs={SETTINGS_TABS} />

      {messageText && (
        <s-section>
          <div style={{ background: "#e3f1ec", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#065f46", fontWeight: 600 }}>
            {messageText}
          </div>
        </s-section>
      )}

      {/* Server-side error + bypass button */}
      {result?.error && (
        <s-section>
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "10px", padding: "16px 18px", color: "#b91c1c" }}>
            <div style={{ fontWeight: 700, marginBottom: "8px" }}>⚠️ Shopify Billing Error</div>
            <div style={{ fontSize: "13px", marginBottom: "14px", lineHeight: "1.6" }}>{result.error}</div>
            <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "8px", padding: "12px 14px", color: "#856404", fontSize: "13px", marginBottom: "14px" }}>
              <strong>🔧 Why this happens:</strong> Shopify billing returns 403 when the app is not yet approved as a Public App in Shopify Partners, or the store type doesn't support billing API.
              <br /><br />
              <strong>Quick fix for testing:</strong> Use the "Activate Plan (Bypass Billing)" buttons below to set your plan directly — all features will unlock instantly without going through Shopify.
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {["Starter", "Growth", "Pro"].map((p) => (
                <fetcher.Form key={p} method="post">
                  <input type="hidden" name="intent" value="force-activate" />
                  <input type="hidden" name="plan" value={p} />
                  <button type="submit" style={{ background: "#008060", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 18px", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>
                    ✅ Activate {p} (bypass)
                  </button>
                </fetcher.Form>
              ))}
            </div>
          </div>
        </s-section>
      )}

      {/* Waiting for redirect */}
      {result?.confirmationUrl && (
        <s-section>
          <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "6px", padding: "12px 16px", color: "#1e40af", fontWeight: 600 }}>
            ⏳ Opening billing page… If nothing happens, <a href={result.confirmationUrl} target="_top" style={{ color: "#1d4ed8" }}>click here</a>.
          </div>
        </s-section>
      )}

      <s-section heading="Choose your plan">
        <s-paragraph>
          All plans are billed through Shopify every 30 days. You can switch or cancel at any time.
        </s-paragraph>

        {isTestMode && (
          <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "8px", padding: "14px 16px", marginBottom: "16px", fontSize: "13px", color: "#854d0e" }}>
            <div style={{ fontWeight: 700, marginBottom: "8px" }}>🧪 Test mode is ON — No real charges.</div>
            <div style={{ marginBottom: "12px", lineHeight: "1.6" }}>
              If Shopify billing returns a 403 error (common on development stores before Partners approval),
              use these buttons to activate a plan directly — no Shopify billing needed:
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {["Starter", "Growth", "Pro"].map((p) => (
                <fetcher.Form key={p} method="post">
                  <input type="hidden" name="intent" value="force-activate" />
                  <input type="hidden" name="plan" value={p} />
                  <button type="submit" disabled={activePlan === p} style={{ background: activePlan === p ? "#d1d5db" : "#008060", color: activePlan === p ? "#374151" : "#fff", border: "none", borderRadius: "6px", padding: "8px 16px", fontWeight: 700, fontSize: "12px", cursor: activePlan === p ? "not-allowed" : "pointer" }}>
                    {activePlan === p ? `✓ ${p} Active` : `⚡ Activate ${p}`}
                  </button>
                </fetcher.Form>
              ))}
              {activePlan && (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="force-deactivate" />
                  <button type="submit" style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: "6px", padding: "8px 16px", fontWeight: 700, fontSize: "12px", cursor: "pointer" }}>
                    Reset to Free
                  </button>
                </fetcher.Form>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginTop: "12px" }}>
          {plans.map((plan) => {
            const isActive = activePlan === plan.key;
            return (
              <div
                key={plan.key}
                style={{
                  border: plan.recommended ? "2px solid #1d4ed8" : "1px solid #d2d5d8",
                  borderRadius: "10px",
                  background: "#fff",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  position: "relative",
                }}
              >
                {plan.recommended && (
                  <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: "#1d4ed8", color: "#fff", borderRadius: "12px", padding: "2px 14px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
                    ⭐ Recommended
                  </div>
                )}

                <h3 style={{ margin: 0, fontSize: "18px", color: "#202223" }}>{plan.title}</h3>

                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <div style={{ fontSize: "30px", fontWeight: 700, color: "#111827" }}>${plan.monthlyPriceUsd}</div>
                  <div style={{ color: "#6b7280", fontSize: "14px" }}>USD / month</div>
                </div>

                <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>{plan.description}</p>
                <p style={{ margin: "0", color: "#059669", fontSize: "13px", fontWeight: 600 }}>✨ {plan.trialDays}-day free trial</p>

                <ul style={{ margin: 0, paddingLeft: "18px", color: "#374151", fontSize: "13px", lineHeight: 1.6 }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                {/* Use fetcher.Form — it keeps the JS action handler active */}
                <fetcher.Form method="post" style={{ marginTop: "6px" }}>
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="plan" value={plan.key} />
                  <button
                    type="submit"
                    disabled={isActive || isSubmitting}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "none",
                      cursor: isActive || isSubmitting ? "not-allowed" : "pointer",
                      background: isActive ? "#d1d5db" : isSubmitting ? "#6b7280" : "#008060",
                      color: isActive ? "#374151" : "#ffffff",
                      fontWeight: 600,
                      fontSize: "14px",
                      transition: "background 0.2s",
                    }}
                  >
                    {isSubmitting
                      ? "⏳ Opening billing…"
                      : isActive
                        ? "✓ Current plan"
                        : activePlan
                          ? `Switch to ${plan.title}`
                          : `Start ${plan.trialDays}-day free trial`}
                  </button>
                </fetcher.Form>
              </div>
            );
          })}
        </div>
      </s-section>

      <s-section heading="Billing details" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Charges are processed by Shopify and appear on your Shopify invoice.
          </s-paragraph>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", background: "#f9fafb" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", textTransform: "uppercase", marginBottom: "4px" }}>Current plan</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>
              {activePlan ?? "Free (no active plan)"}
            </div>
            {renewalDate && <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "6px" }}>Renews on {renewalDate}</div>}
            {isTestMode && (
              <div style={{ fontSize: "12px", color: "#92400e", marginTop: "8px" }}>
                Test mode — no live charges.
              </div>
            )}
          </div>

          {activeSubscription && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <input type="hidden" name="subscriptionId" value={activeSubscription.id} />
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #b91c1c",
                  background: "#fee2e2",
                  color: "#b91c1c",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel active subscription
              </button>
            </fetcher.Form>
          )}

          <s-paragraph>
            Cancel any time and keep access until the end of your billing period.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
