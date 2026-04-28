import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, updateSettings } from "../models/settings.server";
import { CURRENCY_OPTIONS, formatMoney, currencySymbol } from "../utils/currency";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Auto-detect the store currency from Shopify
  let shopCurrency = "USD";
  try {
    const res = await admin.graphql(`#graphql
      query { shop { currencyCode } }
    `);
    const data = await res.json();
    shopCurrency = (data as { data?: { shop?: { currencyCode?: string } } }).data?.shop?.currencyCode ?? "USD";
  } catch {
    // keep default
  }

  const settings = await getSettings(session.shop);

  // On first install, auto-save the detected currency
  if (settings.currency === "USD" && shopCurrency !== "USD") {
    await updateSettings(session.shop, { currency: shopCurrency });
    settings.currency = shopCurrency;
  }

  return { settings, shopCurrency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  await updateSettings(session.shop, {
    pointsPerAmount: Number(formData.get("pointsPerAmount")),
    amountPerPoints: Number(formData.get("amountPerPoints")),
    minPurchaseAmount: Number(formData.get("minPurchaseAmount")),
    pointsExpiryDays: Number(formData.get("pointsExpiryDays")),
    isEnabled: formData.get("isEnabled") === "true",
    currency: String(formData.get("currency") || "USD"),
    redemptionEnabled: formData.get("redemptionEnabled") === "true",
    pointsPerDiscount: Number(formData.get("pointsPerDiscount") || 100),
    discountValue: Number(formData.get("discountValue") || 1),
    minPointsRedeem: Number(formData.get("minPointsRedeem") || 100),
    emailEnabled: formData.get("emailEnabled") === "true",
    emailFromName: String(formData.get("emailFromName") || "Loyalty Rewards"),
  });
  return { success: true };
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #c9cccf",
  borderRadius: "4px", fontSize: "14px", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", marginBottom: "4px", fontSize: "14px", fontWeight: "500", color: "#202223",
};
const helpStyle: React.CSSProperties = {
  fontSize: "12px", color: "#6d7175", marginTop: "4px",
};

export default function Settings() {
  const { settings, shopCurrency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saved = fetcher.data?.success;

  // Live-preview the selected currency from the form (before save)
  const activeCurrency =
    (fetcher.formData?.get("currency") as string | null) ?? settings.currency;
  const sym = currencySymbol(activeCurrency);

  const previewAmounts = [50, 100, 250, 500];

  const SETTINGS_TABS = [
    { label: "Settings", to: "/app/settings" },
    { label: "Billing",  to: "/app/billing" },
  ];

  return (
    <s-page heading="Loyalty Points Settings">
      <PageTabs tabs={SETTINGS_TABS} />
      <s-section heading="Configuration">
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">

            {saved && (
              <div style={{ background: "#e3f1ec", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#008060", fontWeight: "600" }}>
                Settings saved successfully
              </div>
            )}

            {/* Currency selector */}
            <div>
              <label style={labelStyle} htmlFor="currency">Store Currency</label>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  id="currency"
                  name="currency"
                  defaultValue={settings.currency}
                  style={{ ...inputStyle, maxWidth: "320px", cursor: "pointer" }}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                <span style={{
                  display: "inline-block", padding: "4px 12px", borderRadius: "12px",
                  fontSize: "12px", fontWeight: "600", background: "#dbeafe", color: "#1e40af",
                }}>
                  Shopify detected: {shopCurrency}
                </span>
              </div>
              <p style={helpStyle}>
                Controls how all amounts are formatted in the admin and customer widget.
                The app auto-detects your store currency but you can override it here.
              </p>
            </div>

            {/* Enable / Disable */}
            <div>
              <label style={labelStyle}>Points System</label>
              <div style={{ display: "flex", gap: "20px" }}>
                {[{ val: "true", label: "Enabled" }, { val: "false", label: "Disabled" }].map(({ val, label }) => (
                  <label key={val} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
                    <input type="radio" name="isEnabled" value={val} defaultChecked={String(settings.isEnabled) === val} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Conversion rate */}
            <div style={{ background: "#f6f6f7", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px" }}>
              <div style={{ ...labelStyle, fontSize: "15px", marginBottom: "14px" }}>Points Conversion Rate</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: "10px", alignItems: "end" }}>
                <div>
                  <label style={labelStyle} htmlFor="pointsPerAmount">Points Awarded</label>
                  <input
                    id="pointsPerAmount"
                    name="pointsPerAmount"
                    type="number"
                    min="1"
                    defaultValue={settings.pointsPerAmount}
                    style={inputStyle}
                    required
                  />
                </div>
                <div style={{ textAlign: "center", paddingBottom: "10px", color: "#6d7175", fontWeight: "600" }}>per</div>
                <div>
                  <label style={labelStyle} htmlFor="amountPerPoints">
                    Amount Spent ({sym})
                  </label>
                  <input
                    id="amountPerPoints"
                    name="amountPerPoints"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={settings.amountPerPoints}
                    style={inputStyle}
                    required
                  />
                </div>
              </div>
              <p style={{ ...helpStyle, marginTop: "10px" }}>
                Example: 10 points per {sym}100 — a {formatMoney(250, activeCurrency)} purchase earns{" "}
                {Math.floor(250 * (settings.pointsPerAmount / settings.amountPerPoints))} points
              </p>
            </div>

            {/* Minimum purchase */}
            <div>
              <label style={labelStyle} htmlFor="minPurchaseAmount">
                Minimum Purchase Amount
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: "220px" }}>
                <span style={{ color: "#6d7175", fontWeight: "500", fontSize: "14px", minWidth: "28px" }}>{sym}</span>
                <input
                  id="minPurchaseAmount"
                  name="minPurchaseAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={settings.minPurchaseAmount}
                  style={{ ...inputStyle }}
                />
              </div>
              <p style={helpStyle}>Minimum order total required to earn points (0 = no minimum)</p>
            </div>

            {/* Expiry */}
            <div>
              <label style={labelStyle} htmlFor="pointsExpiryDays">Points Expiry (days)</label>
              <input
                id="pointsExpiryDays"
                name="pointsExpiryDays"
                type="number"
                min="0"
                defaultValue={settings.pointsExpiryDays}
                style={{ ...inputStyle, maxWidth: "200px" }}
              />
              <p style={helpStyle}>0 = points never expire</p>
            </div>

            {/* ── Redemption Settings ── */}
            <div id="redemption" style={{ borderTop: "2px solid #e1e3e5", paddingTop: "20px", marginTop: "8px" }}>
              <div style={{ ...labelStyle, fontSize: "15px", marginBottom: "14px" }}>Redemption Settings</div>

              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>Allow Customers to Redeem Points</label>
                <div style={{ display: "flex", gap: "20px" }}>
                  {[{ val: "true", label: "Enabled" }, { val: "false", label: "Disabled" }].map(({ val, label }) => (
                    <label key={val} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
                      <input type="radio" name="redemptionEnabled" value={val} defaultChecked={String(settings.redemptionEnabled) === val} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ background: "#f6f6f7", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px", marginBottom: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: "10px", alignItems: "end" }}>
                  <div>
                    <label style={labelStyle} htmlFor="pointsPerDiscount">Points Required</label>
                    <input id="pointsPerDiscount" name="pointsPerDiscount" type="number" min="1" defaultValue={settings.pointsPerDiscount} style={inputStyle} required />
                  </div>
                  <div style={{ textAlign: "center", paddingBottom: "10px", color: "#6d7175", fontWeight: "600" }}>=</div>
                  <div>
                    <label style={labelStyle} htmlFor="discountValue">Discount Value ({sym})</label>
                    <input id="discountValue" name="discountValue" type="number" min="0.01" step="0.01" defaultValue={settings.discountValue} style={inputStyle} required />
                  </div>
                </div>
                <p style={{ ...helpStyle, marginTop: "10px" }}>
                  E.g. 100 points = {sym}1 discount. A customer with 500 points can redeem for {formatMoney((500 / settings.pointsPerDiscount) * settings.discountValue, activeCurrency)}.
                </p>
              </div>

              <div>
                <label style={labelStyle} htmlFor="minPointsRedeem">Minimum Points to Redeem</label>
                <input id="minPointsRedeem" name="minPointsRedeem" type="number" min="1" defaultValue={settings.minPointsRedeem} style={{ ...inputStyle, maxWidth: "200px" }} />
                <p style={helpStyle}>Customers must have at least this many points before they can redeem</p>
              </div>
            </div>

            {/* ── Email Settings ── */}
            <div style={{ borderTop: "2px solid #e1e3e5", paddingTop: "20px", marginTop: "8px" }}>
              <div style={{ ...labelStyle, fontSize: "15px", marginBottom: "14px" }}>Email Notifications</div>

              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>Send Email Notifications to Customers</label>
                <div style={{ display: "flex", gap: "20px" }}>
                  {[{ val: "true", label: "Enabled" }, { val: "false", label: "Disabled" }].map(({ val, label }) => (
                    <label key={val} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
                      <input type="radio" name="emailEnabled" value={val} defaultChecked={String(settings.emailEnabled) === val} />
                      {label}
                    </label>
                  ))}
                </div>
                <p style={helpStyle}>Sends email on submission approval/rejection and when points are earned</p>
              </div>

              <div>
                <label style={labelStyle} htmlFor="emailFromName">Sender Name</label>
                <input id="emailFromName" name="emailFromName" type="text" defaultValue={settings.emailFromName} style={{ ...inputStyle, maxWidth: "300px" }} />
                <p style={helpStyle}>Name shown in customer email (e.g. "My Store Rewards")</p>
              </div>
            </div>

            <div style={{ paddingTop: "8px" }}>
              <s-button {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                Save Settings
              </s-button>
            </div>

          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Sidebar preview */}
      <s-section heading="Live Preview" slot="aside">
        <s-stack direction="block" gap="base">
          <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Earning Rate</div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#008060" }}>{settings.pointsPerAmount} pts</div>
            <div style={{ fontSize: "13px", color: "#6d7175" }}>per {formatMoney(settings.amountPerPoints, activeCurrency)} spent</div>
          </div>

          <s-paragraph>
            <strong>{(settings.pointsPerAmount / settings.amountPerPoints).toFixed(3)}</strong> points per {sym}1
          </s-paragraph>

          {settings.minPurchaseAmount > 0 && (
            <s-paragraph>
              Min order: <strong>{formatMoney(settings.minPurchaseAmount, activeCurrency)}</strong>
            </s-paragraph>
          )}

          <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: "12px" }}>
            <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Example Orders</div>
            {previewAmounts.map((amt) => {
              const eligible = settings.isEnabled && amt >= settings.minPurchaseAmount;
              const pts = eligible
                ? Math.floor(amt * (settings.pointsPerAmount / settings.amountPerPoints))
                : 0;
              return (
                <div key={amt} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: "13px", borderBottom: "1px solid #f1f1f1" }}>
                  <span style={{ color: "#6d7175" }}>{formatMoney(amt, activeCurrency)}</span>
                  <strong style={{ color: pts > 0 ? "#008060" : "#aab0b5" }}>
                    {pts > 0 ? `+${pts} pts` : eligible ? "0 pts" : "below min"}
                  </strong>
                </div>
              );
            })}
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
