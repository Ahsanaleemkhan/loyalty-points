import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getTiers, upsertTier, deleteTier, DEFAULT_TIERS } from "../models/tiers.server";
import { getSettings, updateSettings } from "../models/settings.server";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [tiers, settings] = await Promise.all([getTiers(session.shop), getSettings(session.shop)]);
  return { tiers, tiersEnabled: settings.tiersEnabled };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "toggle") {
    const enabled = formData.get("tiersEnabled") === "true";
    await updateSettings(session.shop, { tiersEnabled: enabled });
    return { success: `VIP Tiers ${enabled ? "enabled" : "disabled"}` };
  }

  if (intent === "seed") {
    const existing = await getTiers(session.shop);
    if (existing.length === 0) {
      for (const t of DEFAULT_TIERS) await upsertTier(session.shop, t);
    }
    return { success: "Default tiers created" };
  }

  if (intent === "save") {
    const id = String(formData.get("id") || "");
    const perksRaw = String(formData.get("perks") || "");
    const perks = perksRaw.split("\n").map((p) => p.trim()).filter(Boolean);
    await upsertTier(
      session.shop,
      {
        name: String(formData.get("name")),
        minPoints: Number(formData.get("minPoints")),
        multiplier: Number(formData.get("multiplier")),
        color: String(formData.get("color") || "#008060"),
        perks,
        sortOrder: Number(formData.get("sortOrder") || 0),
      },
      id || undefined,
    );
    return { success: "Tier saved" };
  }

  if (intent === "delete") {
    await deleteTier(String(formData.get("id")));
    return { success: "Tier deleted" };
  }

  return { error: "Unknown intent" };
};

const PROGRAM_TABS = [
  { label: "VIP Tiers",     to: "/app/tiers" },
  { label: "Earning Rules", to: "/app/rules" },
  { label: "Referrals",     to: "/app/referrals" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px", boxSizing: "border-box",
};

export default function Tiers() {
  const { tiers, tiersEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const msg = fetcher.data && "success" in fetcher.data ? (fetcher.data as { success: string }).success : null;

  return (
    <s-page heading="VIP Tiers">
      <PageTabs tabs={PROGRAM_TABS} />
      {msg && (
        <s-section>
          <div style={{ background: "#d1fae5", border: "1px solid #008060", borderRadius: "6px", padding: "12px 16px", color: "#065f46", fontWeight: "600" }}>{msg}</div>
        </s-section>
      )}

      {/* Enable/Disable */}
      <s-section heading="VIP Tier System">
        <fetcher.Form method="post" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input type="hidden" name="intent" value="toggle" />
          <input type="hidden" name="tiersEnabled" value={String(!tiersEnabled)} />
          <s-paragraph>
            Status: <strong style={{ color: tiersEnabled ? "#008060" : "#c0392b" }}>{tiersEnabled ? "Enabled" : "Disabled"}</strong>
          </s-paragraph>
          <button type="submit" style={{ padding: "8px 18px", background: tiersEnabled ? "#fee2e2" : "#008060", color: tiersEnabled ? "#b91c1c" : "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600", fontSize: "13px" }}>
            {tiersEnabled ? "Disable Tiers" : "Enable Tiers"}
          </button>
          {tiers.length === 0 && (
            <fetcher.Form method="post" style={{ display: "inline" }}>
              <input type="hidden" name="intent" value="seed" />
              <button type="submit" style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600", fontSize: "13px" }}>
                Create Default Tiers
              </button>
            </fetcher.Form>
          )}
        </fetcher.Form>
        <s-paragraph>
          When enabled, customers earn multiplied points based on their lifetime points balance tier.
          Tier membership is calculated from total lifetime points ever earned.
        </s-paragraph>
      </s-section>

      {/* Existing tiers */}
      {tiers.length > 0 && (
        <s-section heading="Current Tiers">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {tiers.map((tier) => (
              <div key={tier.id} style={{ border: `2px solid ${tier.color}`, borderRadius: "8px", padding: "16px", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                      <span style={{ display: "inline-block", width: "14px", height: "14px", borderRadius: "50%", background: tier.color }} />
                      <strong style={{ fontSize: "16px", color: tier.color }}>{tier.name}</strong>
                      <span style={{ fontSize: "12px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "12px", color: "#374151" }}>
                        {tier.multiplier}x multiplier
                      </span>
                    </div>
                    <div style={{ fontSize: "13px", color: "#6d7175" }}>From <strong>{tier.minPoints.toLocaleString()} points</strong> lifetime earned</div>
                    {tier.perks.length > 0 && (
                      <ul style={{ margin: "8px 0 0 16px", padding: 0, fontSize: "13px", color: "#6d7175" }}>
                        {tier.perks.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    )}
                  </div>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={tier.id} />
                    <button type="submit" style={{ padding: "6px 14px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #b91c1c", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                      Delete
                    </button>
                  </fetcher.Form>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}

      {/* Add new tier */}
      <s-section heading="Add / Edit Tier">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Tier Name</label>
                <input name="name" type="text" placeholder="e.g. Gold" style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Min Points (lifetime)</label>
                <input name="minPoints" type="number" min="0" placeholder="0" style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Points Multiplier</label>
                <input name="multiplier" type="number" min="1" step="0.1" placeholder="1.5" style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Color</label>
                <input name="color" type="color" defaultValue="#008060" style={{ ...inputStyle, padding: "4px", height: "38px" }} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>Perks (one per line)</label>
              <textarea name="perks" rows={3} placeholder={"Earn 2x points\nFree shipping\nExclusive deals"} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <input name="sortOrder" type="hidden" value={tiers.length} />
            <s-button>Add Tier</s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="How Tiers Work" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>Tiers are based on <strong>lifetime total points earned</strong> (not current balance).</s-paragraph>
          <s-paragraph>The <strong>multiplier</strong> is applied to base points at the time of earning. e.g. 2x means a $100 purchase that normally earns 10 points instead earns 20.</s-paragraph>
          <s-paragraph>Customers are notified by email when they reach a new tier.</s-paragraph>
          <s-paragraph>Set min points to 0 for the base tier — all customers start here.</s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
