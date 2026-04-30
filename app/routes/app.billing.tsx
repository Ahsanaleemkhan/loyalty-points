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
        (s) => s.status === "ACTIVE" && isBillingPlanName(s.name),
      ) ?? null;
  } catch (e) {
    console.warn("[billing loader] billing.check failed:", (e as Error)?.message);
  }

  const activePlan = activeSubscription?.name ?? null;
  const tier = resolvePlanTier(activePlan);

  try {
    await prisma.appSettings.upsert({
      where:  { shop: session.shop },
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
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData  = await request.formData();
  const intent    = String(formData.get("intent") || "");
  const isTestMode = await getBillingTestMode();

  if (intent === "subscribe") {
    const requestedPlan = String(formData.get("plan") || "");
    if (!isBillingPlanName(requestedPlan)) return { error: "Invalid plan." };

    const appUrl    = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const returnUrl = `${appUrl}/app/billing?message=approved&shop=${session.shop}`;

    try {
      await (billing as any).request({ plan: requestedPlan, isTest: isTestMode, returnUrl });
      return { error: "Billing request did not redirect as expected." };
    } catch (thrown: unknown) {
      if (thrown instanceof Response) {
        if (thrown.status === 200) {
          try {
            const body = await thrown.clone().json() as Record<string, unknown>;
            const confirmationUrl =
              (body.redirectUrl as string) || (body.confirmationUrl as string) || null;
            if (confirmationUrl) return { confirmationUrl };
          } catch { /* fall through */ }
          return thrown;
        }
        if (thrown.status === 302 || thrown.status === 301) {
          const confirmationUrl = thrown.headers.get("location");
          if (confirmationUrl) return { confirmationUrl };
        }
        console.error("[billing] Unexpected Response:", thrown.status);
        return { error: `Billing error (HTTP ${thrown.status}). Please try again or contact support.` };
      }
      const msg = (thrown as Error)?.message ?? String(thrown);
      console.error("[billing] billing.request error:", msg);
      return { error: `Could not start billing: ${msg}` };
    }
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") || "");
    if (!subscriptionId) return { error: "Missing subscription ID." };

    try {
      await billing.cancel({ subscriptionId, isTest: isTestMode, prorate: false });
    } catch (e: any) {
      return { error: `Cancel failed: ${e?.message ?? e}` };
    }

    await prisma.appSettings.upsert({
      where:  { shop: session.shop },
      update: { planTier: "Free" },
      create: { shop: session.shop, planTier: "Free" },
    });

    return redirect("/app/billing?message=cancelled");
  }

  return redirect("/app/billing");
};

const SETTINGS_TABS = [
  { label: "Settings", to: "/app/settings" },
  { label: "Billing",  to: "/app/billing"  },
];

function getMessageText(message: string | null) {
  if (message === "approved")  return "✅ Subscription activated! Your plan is now live.";
  if (message === "cancelled") return "Subscription cancelled. You're back on the Free plan.";
  return null;
}

export default function BillingPage() {
  const { plans, activePlan, activeSubscription, message } = useLoaderData<typeof loader>();
  const fetcher     = useFetcher<typeof action>();
  const result      = fetcher.data as any;
  const messageText = getMessageText(message);
  const isSubmitting = fetcher.state === "submitting";

  // Break out of Shopify iframe for billing confirmation redirect
  useEffect(() => {
    if (result?.confirmationUrl) {
      try { (window.top ?? window).location.href = result.confirmationUrl; }
      catch { window.location.href = result.confirmationUrl; }
    }
  }, [result?.confirmationUrl]);

  const renewalDate = activeSubscription?.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  return (
    <s-page heading="Billing & Plans">
      <PageTabs tabs={SETTINGS_TABS} />

      {/* Success / cancellation message */}
      {messageText && (
        <s-section>
          <div style={{ background: "#e3f1ec", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#065f46", fontWeight: 600 }}>
            {messageText}
          </div>
        </s-section>
      )}

      {/* Billing error */}
      {result?.error && (
        <s-section>
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "14px 16px", color: "#b91c1c" }}>
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>⚠️ Billing Error</div>
            <div style={{ fontSize: "13px" }}>{result.error}</div>
          </div>
        </s-section>
      )}

      {/* Redirect pending */}
      {result?.confirmationUrl && (
        <s-section>
          <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "6px", padding: "12px 16px", color: "#1e40af", fontWeight: 600 }}>
            ⏳ Opening billing page… If nothing happens,{" "}
            <a href={result.confirmationUrl} target="_top" style={{ color: "#1d4ed8" }}>click here</a>.
          </div>
        </s-section>
      )}

      {/* Plan cards */}
      <s-section heading="Choose your plan">
        <s-paragraph>
          All plans include a free trial. Billed through Shopify every 30 days — cancel any time.
        </s-paragraph>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginTop: "16px" }}>
          {plans.map((plan) => {
            const isActive = activePlan === plan.key;
            return (
              <div
                key={plan.key}
                style={{
                  border: plan.recommended ? "2px solid #1d4ed8" : "1px solid #d2d5d8",
                  borderRadius: "10px",
                  background: "#fff",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  position: "relative",
                }}
              >
                {plan.recommended && (
                  <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: "#1d4ed8", color: "#fff", borderRadius: "12px", padding: "2px 14px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
                    ⭐ Most Popular
                  </div>
                )}

                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "18px", color: "#202223" }}>{plan.title}</h3>
                  <p style={{ margin: 0, color: "#6b7280", fontSize: "13px" }}>{plan.description}</p>
                </div>

                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <span style={{ fontSize: "32px", fontWeight: 800, color: "#111827" }}>${plan.monthlyPriceUsd}</span>
                  <span style={{ color: "#6b7280", fontSize: "14px" }}>USD / month</span>
                </div>

                {plan.trialDays > 0 && (
                  <div style={{ background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", color: "#065f46", fontWeight: 600 }}>
                    ✨ {plan.trialDays}-day free trial — no charge until trial ends
                  </div>
                )}

                <ul style={{ margin: 0, paddingLeft: "18px", color: "#374151", fontSize: "13px", lineHeight: 1.7, flexGrow: 1 }}>
                  {plan.features.map((f) => <li key={f}>{f}</li>)}
                </ul>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="plan"   value={plan.key} />
                  <button
                    type="submit"
                    disabled={isActive || isSubmitting}
                    style={{
                      width: "100%", padding: "11px 14px", borderRadius: "8px", border: "none",
                      cursor: isActive || isSubmitting ? "not-allowed" : "pointer",
                      background: isActive ? "#d1d5db" : "#008060",
                      color: isActive ? "#374151" : "#fff",
                      fontWeight: 700, fontSize: "14px",
                    }}
                  >
                    {isSubmitting ? "⏳ Opening…" : isActive ? "✓ Current plan" : activePlan ? `Switch to ${plan.title}` : `Start free trial`}
                  </button>
                </fetcher.Form>
              </div>
            );
          })}
        </div>
      </s-section>

      {/* Billing details aside */}
      <s-section heading="Billing details" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Charges are processed by Shopify and appear on your Shopify invoice.
          </s-paragraph>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px", background: "#f9fafb" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Current plan</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>
              {activePlan ?? "Free"}
            </div>
            {renewalDate && (
              <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "6px" }}>
                Renews {renewalDate}
              </div>
            )}
          </div>

          {activeSubscription && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent"         value="cancel" />
              <input type="hidden" name="subscriptionId" value={activeSubscription.id} />
              <button
                type="submit"
                disabled={isSubmitting}
                onClick={(e) => { if (!confirm("Cancel your subscription? You'll stay on your current plan until the billing period ends.")) e.preventDefault(); }}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "8px",
                  border: "1px solid #b91c1c", background: "#fee2e2",
                  color: "#b91c1c", fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancel subscription
              </button>
            </fetcher.Form>
          )}

          <s-paragraph>
            Cancel any time. Access continues until the end of your billing period.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
