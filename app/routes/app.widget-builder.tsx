import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { PageTabs } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  // eslint-disable-next-line no-undef
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return {
    shop: session.shop,
    appUrl,
    widgetTitle:    (settings as any).widgetTitle    ?? "My Rewards",
    widgetColor:    (settings as any).widgetColor    ?? "#008060",
    widgetPosition: (settings as any).widgetPosition ?? "bottom-right",
    widgetBgColor:  (settings as any).widgetBgColor  ?? "#ffffff",
    redemptionEnabled: settings.redemptionEnabled,
    tiersEnabled:      settings.tiersEnabled,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  await prisma.appSettings.upsert({
    where:  { shop: session.shop },
    update: {
      widgetTitle:    String(fd.get("widgetTitle")    || "My Rewards"),
      widgetColor:    String(fd.get("widgetColor")    || "#008060"),
      widgetPosition: String(fd.get("widgetPosition") || "bottom-right"),
      widgetBgColor:  String(fd.get("widgetBgColor")  || "#ffffff"),
    },
    create: {
      shop:           session.shop,
      widgetTitle:    String(fd.get("widgetTitle")    || "My Rewards"),
      widgetColor:    String(fd.get("widgetColor")    || "#008060"),
      widgetPosition: String(fd.get("widgetPosition") || "bottom-right"),
      widgetBgColor:  String(fd.get("widgetBgColor")  || "#ffffff"),
    },
  });
  return { success: true };
};

const TABS = ["Appearance", "Content", "Features", "Setup"];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ background: copied ? "#008060" : "#374151", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", fontSize: "12px", fontWeight: "600", cursor: "pointer", transition: "background 0.2s" }}
    >
      {copied ? "✓ Copied!" : "Copy Code"}
    </button>
  );
}

export default function WidgetBuilder() {
  const data = useLoaderData<typeof loader>();
  const appUrl = data.appUrl || "https://YOUR-APP-URL.trycloudflare.com";
  const fetcher = useFetcher<typeof action>();
  const saved = fetcher.data && "success" in fetcher.data;

  const [activeTab, setActiveTab] = useState("Appearance");

  // Live preview values — start from saved, update as form changes
  const [color,    setColor]    = useState(data.widgetColor);
  const [bgColor,  setBgColor]  = useState(data.widgetBgColor);
  const [title,    setTitle]    = useState(data.widgetTitle);
  const [position, setPosition] = useState(data.widgetPosition);

  const themeEditorUrl = `https://${data.shop}/admin/themes/current/editor`;

  const themeBlockCode = `{%- if customer -%}
  <link rel="stylesheet" href="${appUrl}/widget.css">
  <div
    class="loyalty-widget"
    data-app-url="${appUrl}"
    data-shop="{{ shop.permanent_domain }}"
    data-customer-id="gid://shopify/Customer/{{ customer.id }}"
    data-customer-email="{{ customer.email }}"
    data-customer-name="{{ customer.first_name }} {{ customer.last_name }}"
    style="--lw-primary: ${color};"
  ></div>
  <script src="${appUrl}/widget.js" defer></script>
{%- else -%}
  <p style="text-align:center;padding:20px;">
    Please <a href="/account/login?return_url={{ request.path | url_encode }}">log in</a> to view your rewards.
  </p>
{%- endif -%}`;

  const fullPageCode = `{%- if customer -%}
  <link rel="stylesheet" href="${appUrl}/widget.css">
  <div
    class="loyalty-widget"
    data-layout="full"
    data-app-url="${appUrl}"
    data-shop="{{ shop.permanent_domain }}"
    data-customer-id="gid://shopify/Customer/{{ customer.id }}"
    data-customer-email="{{ customer.email }}"
    data-customer-name="{{ customer.first_name }} {{ customer.last_name }}"
    style="--lw-primary: ${color};"
  ></div>
  <script src="${appUrl}/widget.js" defer></script>
{%- else -%}
  <div style="max-width:520px;margin:60px auto;text-align:center;padding:48px 24px;background:#f9fafb;border-radius:16px;">
    <div style="font-size:48px;margin-bottom:12px;">🏆</div>
    <h2 style="margin:0 0 10px;font-size:22px;color:#111827;">Loyalty Rewards</h2>
    <p style="margin:0 0 22px;color:#6b7280;font-size:14px;">Sign in to view your points balance, redeem rewards, and submit receipts.</p>
    <a href="/account/login?return_url={{ request.path | url_encode }}"
       style="display:inline-block;padding:12px 32px;background:${color};color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;">
      Sign in
    </a>
  </div>
{%- endif -%}`;

  const receiptPageCode = `{%- if customer -%}
  <link rel="stylesheet" href="${appUrl}/widget.css">
  <div
    class="loyalty-widget"
    data-app-url="${appUrl}"
    data-shop="{{ shop.permanent_domain }}"
    data-customer-id="gid://shopify/Customer/{{ customer.id }}"
    data-customer-email="{{ customer.email }}"
    data-customer-name="{{ customer.first_name }} {{ customer.last_name }}"
    data-default-tab="submit"
    style="--lw-primary: ${color};"
  ></div>
  <script src="${appUrl}/widget.js" defer></script>
{%- else -%}
  <p style="text-align:center;padding:20px;">
    Please <a href="/account/login?return_url={{ request.path | url_encode }}">log in</a> to submit a receipt.
  </p>
{%- endif -%}`;

  const cartPageCode = `{%- if customer -%}
  <link rel="stylesheet" href="${appUrl}/widget.css">
  <div
    class="loyalty-widget"
    data-context="cart"
    data-default-tab="redeem"
    data-app-url="${appUrl}"
    data-shop="{{ shop.permanent_domain }}"
    data-customer-id="gid://shopify/Customer/{{ customer.id }}"
    data-customer-email="{{ customer.email }}"
    data-customer-name="{{ customer.first_name }} {{ customer.last_name }}"
    style="--lw-primary: ${color};"
  ></div>
  <script src="${appUrl}/widget.js" defer></script>
{%- else -%}
  <p style="text-align:center;padding:16px;font-size:14px;color:#6b7280;">
    <a href="/account/login?return_url={{ request.path | url_encode }}" style="color:${color};font-weight:600;">Sign in</a> to redeem your points at checkout.
  </p>
{%- endif -%}`;

  const floatingBadgeCode = `{%- if customer -%}
  <link rel="stylesheet" href="${appUrl}/widget.css">
  <div
    class="loyalty-widget"
    data-app-url="${appUrl}"
    data-shop="{{ shop.permanent_domain }}"
    data-customer-id="gid://shopify/Customer/{{ customer.id }}"
    data-customer-email="{{ customer.email }}"
    data-customer-name="{{ customer.first_name }} {{ customer.last_name }}"
    data-floating="true"
    data-position="${position}"
    style="--lw-primary: ${color};"
  ></div>
  <script src="${appUrl}/widget.js" async></script>
{%- endif -%}`;

  const tabStyle = (t: string) => ({
    padding: "10px 18px",
    fontSize: "13px",
    fontWeight: activeTab === t ? "700" : "500",
    color: activeTab === t ? color : "#6d7175",
    cursor: "pointer",
    background: "none",
    border: "none",
    borderBottom: activeTab === t ? `2px solid ${color}` : "2px solid transparent",
    whiteSpace: "nowrap" as const,
  });

  const TOOLS_TABS = [
    { label: "Widget Builder", to: "/app/widget-builder" },
    { label: "Store Sync",     to: "/app/store-sync" },
    { label: "Sync Orders",    to: "/app/sync-orders" },
  ];

  return (
    <s-page heading="Widget Builder">
      <PageTabs tabs={TOOLS_TABS} />

      {/* ── Top bar ── */}
      <s-section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ fontWeight: "700", fontSize: "16px" }}>Loyalty Widget</div>
            <div style={{ fontSize: "13px", color: "#6d7175" }}>Customize your storefront loyalty widget and get embed code</div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <a href={themeEditorUrl} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-secondary">
              Open Theme Editor ↗
            </a>
            {saved && (
              <span style={{ fontSize: "13px", color: "#008060", fontWeight: "600", alignSelf: "center" }}>✓ Saved!</span>
            )}
          </div>
        </div>
      </s-section>

      {/* ── Main two-column layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0", alignItems: "start" }}>

        {/* LEFT — Config panel */}
        <s-section heading="Widget Settings">

          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: "20px", overflowX: "auto" }}>
            {TABS.map((t) => (
              <button key={t} type="button" style={tabStyle(t)} onClick={() => setActiveTab(t)}>{t}</button>
            ))}
          </div>

          <fetcher.Form method="post">

            {/* ── APPEARANCE TAB ── */}
            {activeTab === "Appearance" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>Widget Title</label>
                  <input
                    name="widgetTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="lp-input"
                    style={{ width: "100%" }}
                    placeholder="My Rewards"
                  />
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Shown in the floating button and panel header</div>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>Primary Color</label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="color"
                      name="widgetColor"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      style={{ width: "52px", height: "40px", padding: "2px", borderRadius: "8px", border: "1px solid #d2d5d8", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="lp-input"
                      style={{ width: "120px" }}
                      placeholder="#008060"
                    />
                    <span style={{ fontSize: "12px", color: "#9ca3af" }}>Buttons, balance card, accents</span>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>Background Color</label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="color"
                      name="widgetBgColor"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      style={{ width: "52px", height: "40px", padding: "2px", borderRadius: "8px", border: "1px solid #d2d5d8", cursor: "pointer" }}
                    />
                    <input
                      type="text"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="lp-input"
                      style={{ width: "120px" }}
                      placeholder="#ffffff"
                    />
                    <span style={{ fontSize: "12px", color: "#9ca3af" }}>Widget card background</span>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "13px", fontWeight: "600", display: "block", marginBottom: "6px" }}>Floating Button Position</label>
                  <div style={{ display: "flex", gap: "10px" }}>
                    {["bottom-right", "bottom-left"].map((p) => (
                      <label key={p} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px" }}>
                        <input
                          type="radio"
                          name="widgetPosition"
                          value={p}
                          checked={position === p}
                          onChange={() => setPosition(p)}
                        />
                        {p === "bottom-right" ? "Bottom Right" : "Bottom Left"}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── CONTENT TAB ── */}
            {activeTab === "Content" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "14px" }}>
                  <div style={{ fontWeight: "600", marginBottom: "10px", fontSize: "13px" }}>Widget Tabs Visible to Customers</div>
                  {[
                    { id: "history",  label: "📜 Points History",     desc: "Transaction and earning history" },
                    { id: "redeem",   label: "🎟️ Redeem Points",      desc: "Convert points to discount codes" },
                    { id: "codes",    label: "🏷️ My Discount Codes",  desc: "View previously generated codes" },
                    { id: "birthday", label: "🎂 Birthday Bonus",      desc: "Save birthday for auto points" },
                    { id: "refer",    label: "👥 Refer & Earn",        desc: "Share referral link with friends" },
                    { id: "receipt",  label: "🧾 Submit Receipt",      desc: "Upload physical purchase receipts" },
                  ].map((tab) => (
                    <div key={tab.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "500" }}>{tab.label}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>{tab.desc}</div>
                      </div>
                      <div style={{ width: "32px", height: "18px", background: color, borderRadius: "9px", cursor: "pointer", position: "relative" }}>
                        <div style={{ width: "14px", height: "14px", background: "#fff", borderRadius: "50%", position: "absolute", right: "2px", top: "2px" }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>Tab visibility control coming soon — all tabs are enabled by default.</div>
              </div>
            )}

            {/* ── FEATURES TAB ── */}
            {activeTab === "Features" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {[
                  { icon: "💰", title: "Points Balance Display", desc: "Live balance shown at top of widget", enabled: true },
                  { icon: "🏆", title: "VIP Tier Badge", desc: "Shows customer's current tier", enabled: data.tiersEnabled },
                  { icon: "⚠️", title: "Expiry Warning Banner", desc: "Alerts customers when points expire soon", enabled: true },
                  { icon: "🎟️", title: "Redemptions", desc: "Convert points to discount codes", enabled: data.redemptionEnabled },
                  { icon: "🧾", title: "Physical Receipts", desc: "Customers upload receipts for offline purchases", enabled: true },
                  { icon: "👥", title: "Referral Program", desc: "Customers share referral links", enabled: true },
                  { icon: "🎂", title: "Birthday Points", desc: "Auto-award points on customer birthday", enabled: true },
                ].map((f) => (
                  <div key={f.title} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: f.enabled ? "#f0fdf4" : "#f9fafb", border: `1px solid ${f.enabled ? "#a7f3d0" : "#e5e7eb"}`, borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <span style={{ fontSize: "18px" }}>{f.icon}</span>
                      <div>
                        <div style={{ fontWeight: "600", fontSize: "13px" }}>{f.title}</div>
                        <div style={{ fontSize: "12px", color: "#6d7175" }}>{f.desc}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: "700", padding: "3px 10px", borderRadius: "10px", background: f.enabled ? "#008060" : "#9ca3af", color: "#fff" }}>
                      {f.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>Toggle features individually in Settings → Redemptions / Tiers.</div>
              </div>
            )}

            {/* ── SETUP TAB ── */}
            {activeTab === "Setup" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "14px 16px" }}>
                  <div style={{ fontWeight: "700", color: "#0369a1", marginBottom: "10px" }}>📋 Installation Steps</div>
                  <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#374151", lineHeight: "2" }}>
                    <li>Click <strong>Open Theme Editor</strong> at the top right</li>
                    <li>In the left panel, click <strong>+ Add section</strong></li>
                    <li>Search for <strong>"Loyalty Widget"</strong> and add it</li>
                    <li>Position it on your page and click <strong>Save</strong></li>
                    <li>For physical receipts, create a dedicated <strong>Loyalty Page</strong></li>
                  </ol>
                </div>
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "14px 16px", fontSize: "13px", color: "#92400e" }}>
                  <strong>Physical Receipt Page:</strong> Create a new Shopify Page (e.g. "Submit Receipt"), switch to HTML/code view, and paste the "Receipt Page" embed code from the Embed Snippets section below.
                </div>
              </div>
            )}

            {/* Save button — always visible */}
            {(activeTab === "Appearance") && (
              <button type="submit" className="lp-btn lp-btn-primary" style={{ marginTop: "20px", width: "100%" }}>
                {fetcher.state === "submitting" ? "Saving…" : "Save Configuration"}
              </button>
            )}

          </fetcher.Form>
        </s-section>

        {/* RIGHT — Live Preview */}
        <s-section heading="Live Preview">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: "12px", color: "#10b981", fontWeight: "600" }}>Updates in real-time</span>
          </div>

          {/* Balance card */}
          <div style={{
            background: `linear-gradient(135deg, ${color} 0%, ${color}bb 100%)`,
            borderRadius: "16px",
            padding: "24px",
            color: "#fff",
            marginBottom: "12px",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "100px", height: "100px", borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
            <div style={{ position: "absolute", bottom: "-30px", right: "40px", width: "80px", height: "80px", borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
            <div style={{ fontSize: "12px", opacity: 0.85, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>{title}</div>
            <div style={{ fontSize: "44px", fontWeight: "800", letterSpacing: "-2px", lineHeight: 1 }}>1,250</div>
            <div style={{ fontSize: "13px", opacity: 0.8, marginBottom: "14px" }}>points available</div>
            <div style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(4px)", borderRadius: "10px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px" }}>💎 Gold Member</span>
              <span style={{ fontSize: "12px", fontWeight: "700", background: "rgba(255,255,255,0.3)", borderRadius: "8px", padding: "3px 10px" }}>2.0× multiplier</span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ border: `1px solid #e5e7eb`, borderRadius: "12px", overflow: "hidden", background: bgColor }}>
            <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", overflowX: "auto" }}>
              {["History", "Redeem", "Codes", "Birthday", "Refer", "Receipt"].map((t, i) => (
                <div key={t} style={{
                  padding: "9px 12px",
                  fontSize: "11px",
                  fontWeight: i === 0 ? "700" : "400",
                  color: i === 0 ? color : "#9ca3af",
                  borderBottom: i === 0 ? `2px solid ${color}` : "2px solid transparent",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}>{t}</div>
              ))}
            </div>
            <div style={{ padding: "14px" }}>
              {[
                { label: "🛒 Order #1001 — $49.99", pts: "+50 pts", positive: true },
                { label: "🎁 First Purchase Bonus", pts: "+200 pts", positive: true },
                { label: "⭐ Birthday Bonus", pts: "+100 pts", positive: true },
                { label: "🎟️ Redeemed for $5 off", pts: "−100 pts", positive: false },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f3f4f6", fontSize: "12px" }}>
                  <span style={{ color: "#374151" }}>{row.label}</span>
                  <span style={{ fontWeight: "700", color: row.positive ? color : "#dc2626" }}>{row.pts}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Floating button preview */}
          <div style={{ marginTop: "16px", display: "flex", justifyContent: position === "bottom-right" ? "flex-end" : "flex-start" }}>
            <div style={{
              background: color,
              color: "#fff",
              borderRadius: "50px",
              padding: "11px 20px",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
            }}>
              🏆 {title}
            </div>
          </div>
          <div style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center", marginTop: "6px" }}>
            Floating button — {position}
          </div>
        </s-section>
      </div>

      {/* ── Embed Code Snippets ── */}
      <s-section heading="Embed Code Snippets">
        <s-paragraph>
          Copy and paste one of these snippets into your Shopify theme or page to display the widget.
        </s-paragraph>

        {/* How to embed */}
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "16px" }}>ℹ️</span>
            <div>
              <div style={{ fontWeight: "600", color: "#0369a1", marginBottom: "6px", fontSize: "13px" }}>How to embed</div>
              <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#374151", lineHeight: "1.8" }}>
                <li>Go to Shopify Admin → Online Store → Pages or Themes</li>
                <li>Edit the page where you want the widget</li>
                <li>Switch to HTML / code view</li>
                <li>Paste the snippet below</li>
                <li>Your store domain is auto-filled — just paste and save</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Snippets */}
        {[
          {
            title: "📄 Full-Width Loyalty Page (recommended)",
            desc: "Full-width dashboard layout — sidebar with balance and tier, main area with tabs. Perfect for a dedicated /pages/rewards page. Paste this on a Shopify Page (HTML view).",
            code: fullPageCode,
          },
          {
            title: "🏆 Compact Loyalty Widget",
            desc: "Card-style widget (max 520px) with all tabs — balance, history, redeem, receipt, refer, birthday. Best for sidebars or narrow sections.",
            code: themeBlockCode,
          },
          {
            title: "🧾 Receipt Submission Page",
            desc: "Widget pre-opened on the Submit Receipt tab — perfect for a dedicated 'Submit Receipt' page.",
            code: receiptPageCode,
          },
          {
            title: "🛒 Cart Page — Redeem Points at Checkout",
            desc: "Compact widget pre-opened on Redeem tab. After redemption customers get a one-click 'Apply Discount & Checkout' button. Add to your cart page template.",
            code: cartPageCode,
          },
          {
            title: "💬 Floating Badge (all pages)",
            desc: "Adds a floating loyalty button on every page. Paste in your theme.liquid before </body>.",
            code: floatingBadgeCode,
          },
        ].map((s) => (
          <div key={s.title} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <div>
                <div style={{ fontWeight: "700", fontSize: "14px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>{s.desc}</div>
              </div>
              <CopyBtn text={s.code} />
            </div>
            <div style={{ background: "#1e1e2e", padding: "16px 20px", overflowX: "auto" }}>
              <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "12px", color: "#cdd6f4", whiteSpace: "pre", lineHeight: "1.6" }}>{s.code}</pre>
            </div>
          </div>
        ))}
      </s-section>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
