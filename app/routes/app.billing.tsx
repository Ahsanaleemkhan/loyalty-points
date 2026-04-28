import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];
import {
  BILLING_PLAN_DETAILS,
  BILLING_PLAN_NAMES,
  BILLING_TEST_MODE,
  isBillingPlanName,
} from "../billing/plans";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const billingCheck = await billing.check({
    plans: [...BILLING_PLAN_NAMES],
    isTest: BILLING_TEST_MODE,
  } as any);

  const activeSubscription =
    billingCheck.appSubscriptions.find(
      (subscription) =>
        subscription.status === "ACTIVE" && isBillingPlanName(subscription.name),
    ) ?? null;

  const activePlan = activeSubscription ? activeSubscription.name : null;
  const message = new URL(request.url).searchParams.get("message");

  return {
    plans: BILLING_PLAN_NAMES.map((plan) => ({ key: plan, ...BILLING_PLAN_DETAILS[plan] })),
    activePlan,
    activeSubscription,
    message,
    isTestMode: BILLING_TEST_MODE,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "subscribe") {
    const requestedPlan = String(formData.get("plan") || "");
    if (!isBillingPlanName(requestedPlan)) {
      return new Response("Invalid billing plan", { status: 400 });
    }

    const returnUrl = new URL("/app/billing?message=approved", request.url).toString();
    await billing.request({
      plan: requestedPlan,
      isTest: BILLING_TEST_MODE,
      returnUrl,
    } as any);
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") || "");
    if (!subscriptionId) {
      return new Response("Missing subscription ID", { status: 400 });
    }

    await billing.cancel({
      subscriptionId,
      isTest: BILLING_TEST_MODE,
      prorate: false,
    });

    return redirect("/app/billing?message=cancelled");
  }

  return redirect("/app/billing");
};

function getMessageText(message: string | null) {
  if (message === "approved") {
    return "Billing updated successfully.";
  }
  if (message === "cancelled") {
    return "Subscription cancelled successfully.";
  }
  return null;
}

export default function BillingPage() {
  const { plans, activePlan, activeSubscription, message, isTestMode } = useLoaderData<typeof loader>();
  const messageText = getMessageText(message);
  const renewalDate = activeSubscription?.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const SETTINGS_TABS = [
    { label: "Settings", to: "/app/settings" },
    { label: "Billing",  to: "/app/billing" },
  ];

  return (
    <s-page heading="Billing & Plans">
      <PageTabs tabs={SETTINGS_TABS} />
      {messageText && (
        <s-section>
          <div
            style={{
              background: "#e3f1ec",
              border: "1px solid #008060",
              borderRadius: "6px",
              padding: "12px 16px",
              color: "#065f46",
              fontWeight: 600,
            }}
          >
            {messageText}
          </div>
        </s-section>
      )}

      <s-section heading="Choose your plan">
        <s-paragraph>
          All plans are billed through Shopify app subscriptions every 30 days. You can switch plans at any time.
        </s-paragraph>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "14px",
            marginTop: "12px",
          }}
        >
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
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "18px", color: "#202223" }}>{plan.title}</h3>
                  {plan.recommended && (
                    <span
                      style={{
                        fontSize: "12px",
                        background: "#dbeafe",
                        color: "#1e3a8a",
                        borderRadius: "12px",
                        padding: "2px 10px",
                        fontWeight: 600,
                      }}
                    >
                      Recommended
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                  <div style={{ fontSize: "30px", fontWeight: 700, color: "#111827" }}>${plan.monthlyPriceUsd}</div>
                  <div style={{ color: "#6b7280", fontSize: "14px" }}>USD / month</div>
                </div>

                <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>{plan.description}</p>
                <p style={{ margin: 0, color: "#6b7280", fontSize: "13px" }}>{plan.trialDays}-day free trial</p>

                <ul style={{ margin: 0, paddingLeft: "18px", color: "#374151", fontSize: "13px", lineHeight: 1.5 }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <Form method="post" style={{ marginTop: "6px" }}>
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="plan" value={plan.key} />
                  <button
                    type="submit"
                    disabled={isActive}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "none",
                      cursor: isActive ? "not-allowed" : "pointer",
                      background: isActive ? "#d1d5db" : "#008060",
                      color: isActive ? "#374151" : "#ffffff",
                      fontWeight: 600,
                      fontSize: "14px",
                    }}
                  >
                    {isActive ? "Current plan" : activePlan ? `Switch to ${plan.title}` : "Start free trial"}
                  </button>
                </Form>
              </div>
            );
          })}
        </div>
      </s-section>

      <s-section heading="Billing details" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Charges are processed by Shopify and appear on the merchant's Shopify invoice.
          </s-paragraph>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", background: "#f9fafb" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", textTransform: "uppercase", marginBottom: "4px" }}>Current plan</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>
              {activePlan ?? "No active plan"}
            </div>
            {renewalDate && <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "6px" }}>Renews on {renewalDate}</div>}
            {isTestMode && (
              <div style={{ fontSize: "12px", color: "#92400e", marginTop: "8px" }}>
                Billing is running in test mode. No live charges will be created.
              </div>
            )}
          </div>

          {activeSubscription && (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <input type="hidden" name="subscriptionId" value={activeSubscription.id} />
              <button
                type="submit"
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
            </Form>
          )}

          <s-paragraph>
            All charges appear on your Shopify invoice. You can cancel at any time and keep access until the end of your billing period.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
