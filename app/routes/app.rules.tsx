import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

const PROGRAM_TABS = [
  { label: "VIP Tiers",     to: "/app/tiers" },
  { label: "Earning Rules", to: "/app/rules" },
  { label: "Referrals",     to: "/app/referrals" },
];

const RULE_TYPES = [
  { value: "FIRST_PURCHASE", label: "First Purchase Bonus", desc: "One-time bonus for a customer's very first order" },
  { value: "BIRTHDAY",       label: "Birthday Bonus",       desc: "Points awarded in the customer's birthday month" },
  { value: "REVIEW",         label: "Product Review",       desc: "Reward customers for leaving a product review" },
  { value: "SOCIAL_SHARE",   label: "Social Share",         desc: "Reward customers for sharing on social media" },
  { value: "REFERRAL",       label: "Referral Bonus",       desc: "Points when a referred friend makes their first purchase" },
  { value: "PRODUCT_TAG",    label: "Product Tag Bonus",    desc: "Extra points for purchases including a specific product tag" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rules = await prisma.earningRule.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "asc" },
  });
  return { rules };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "save") {
    const id = String(formData.get("id") || "");
    const configRaw = String(formData.get("config") || "{}");
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(configRaw); } catch { config = {}; }

    const data = {
      shop: session.shop,
      name: String(formData.get("name")),
      type: String(formData.get("type")),
      points: Number(formData.get("points")),
      multiplier: Number(formData.get("multiplier") || 1),
      isEnabled: formData.get("isEnabled") === "true",
      config: JSON.stringify(config),
    };

    if (id) {
      await prisma.earningRule.update({ where: { id }, data });
    } else {
      await prisma.earningRule.create({ data });
    }
    return { success: "Rule saved" };
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const current = await prisma.earningRule.findUnique({ where: { id } });
    if (current) await prisma.earningRule.update({ where: { id }, data: { isEnabled: !current.isEnabled } });
    return { success: "Rule updated" };
  }

  if (intent === "delete") {
    await prisma.earningRule.delete({ where: { id: String(formData.get("id")) } });
    return { success: "Rule deleted" };
  }

  return { error: "Unknown intent" };
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px", boxSizing: "border-box",
};

export default function Rules() {
  const { rules } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const msg = fetcher.data && "success" in fetcher.data ? (fetcher.data as { success: string }).success : null;

  return (
    <s-page heading="Earning Rules">
      <PageTabs tabs={PROGRAM_TABS} />
      {msg && (
        <s-section>
          <div style={{ background: "#d1fae5", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#065f46", fontWeight: "600" }}>{msg}</div>
        </s-section>
      )}

      {/* Existing rules */}
      {rules.length > 0 && (
        <s-section heading="Active Rules">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {rules.map((rule) => (
              <div key={rule.id} style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 16px", background: rule.isEnabled ? "#fff" : "#f9f9f9", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "4px" }}>
                    <strong style={{ fontSize: "14px" }}>{rule.name}</strong>
                    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: "#dbeafe", color: "#1e40af", fontWeight: "600" }}>{rule.type}</span>
                    {!rule.isEnabled && <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: "#f3f4f6", color: "#6b7280", fontWeight: "600" }}>DISABLED</span>}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175" }}>
                    <strong>+{rule.points} points</strong>
                    {rule.multiplier !== 1 && ` × ${rule.multiplier} multiplier`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" style={{ padding: "5px 12px", background: rule.isEnabled ? "#fef3c7" : "#d1fae5", color: rule.isEnabled ? "#92400e" : "#065f46", border: "1px solid", borderColor: rule.isEnabled ? "#d97706" : "#34d399", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                      {rule.isEnabled ? "Disable" : "Enable"}
                    </button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" style={{ padding: "5px 12px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #b91c1c", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>Delete</button>
                  </fetcher.Form>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}

      {/* Add new rule */}
      <s-section heading="Add Earning Rule">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Rule Name</label>
                <input name="name" type="text" placeholder="e.g. First Purchase Bonus" style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Rule Type</label>
                <select name="type" style={{ ...inputStyle, cursor: "pointer" }} required>
                  {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Points to Award</label>
                <input name="points" type="number" min="1" placeholder="50" style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Multiplier (optional)</label>
                <input name="multiplier" type="number" min="1" step="0.1" defaultValue="1" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Status</label>
                <select name="isEnabled" style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </div>
            <s-button>Add Rule</s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Rule Types" slot="aside">
        <s-stack direction="block" gap="base">
          {RULE_TYPES.map((t) => (
            <div key={t.value}>
              <strong style={{ fontSize: "13px" }}>{t.label}</strong>
              <p style={{ fontSize: "12px", color: "#6d7175", margin: "2px 0 0" }}>{t.desc}</p>
            </div>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
