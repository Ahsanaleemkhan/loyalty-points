import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getReferrals, getReferralStats } from "../models/referrals.server";
import { PageTabs } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [referrals, stats] = await Promise.all([
    getReferrals(session.shop),
    getReferralStats(session.shop),
  ]);
  return { referrals, stats };
};

const PROGRAM_TABS = [
  { label: "VIP Tiers",     to: "/app/tiers" },
  { label: "Earning Rules", to: "/app/rules" },
  { label: "Referrals",     to: "/app/referrals" },
];

const thStyle: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "#6d7175", borderBottom: "1px solid #e1e3e5", background: "#f6f6f7" };
const tdStyle: React.CSSProperties = { padding: "12px 14px", fontSize: "14px", borderBottom: "1px solid #e1e3e5" };

function statusBadge(status: string) {
  const converted = status === "CONVERTED";
  return (
    <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", fontWeight: "600", background: converted ? "#d1fae5" : "#fef3c7", color: converted ? "#065f46" : "#92400e" }}>
      {status}
    </span>
  );
}

export default function Referrals() {
  const { referrals, stats } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Referral Program">
      <PageTabs tabs={PROGRAM_TABS} />
      {/* Stats */}
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          {[
            { label: "Total Referrals", value: stats.total },
            { label: "Converted", value: stats.converted },
            { label: "Pending", value: stats.pending },
            { label: "Conversion Rate", value: `${stats.conversionRate}%` },
          ].map((s) => (
            <div key={s.label} style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px", textAlign: "center" }}>
              <div style={{ fontSize: "28px", fontWeight: "700", color: "#008060" }}>{s.value}</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </s-section>

      {/* How it works */}
      <s-section heading="How It Works" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>Customers get a unique referral code from the loyalty widget on your storefront.</s-paragraph>
          <s-paragraph>When a new customer uses their code and places their first order, both the referrer and the referred customer earn bonus points (configured in Earning Rules).</s-paragraph>
          <s-paragraph>A referral converts once the referred customer completes their first purchase.</s-paragraph>
          <s-paragraph><strong>Widget integration:</strong> The referral tab in the loyalty widget auto-generates and displays each customer's unique code.</s-paragraph>
        </s-stack>
      </s-section>

      {/* Referral list */}
      <s-section heading={`All Referrals (${referrals.length})`}>
        {referrals.length === 0 ? (
          <s-paragraph>No referrals yet. Customers generate their referral codes via the storefront loyalty widget.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Referrer</th>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Referred Customer</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Points Awarded</th>
                  <th style={thStyle}>Date</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: "500" }}>{r.referrerName || "—"}</div>
                      <div style={{ fontSize: "12px", color: "#6d7175" }}>{r.referrerEmail}</div>
                    </td>
                    <td style={tdStyle}>
                      <code style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: "4px", fontSize: "13px", fontWeight: "600", letterSpacing: "1px" }}>
                        {r.referralCode}
                      </code>
                    </td>
                    <td style={tdStyle}>
                      {r.referredEmail ? (
                        <div style={{ fontSize: "13px", color: "#374151" }}>{r.referredEmail}</div>
                      ) : (
                        <span style={{ color: "#9ca3af", fontSize: "13px" }}>Not yet used</span>
                      )}
                    </td>
                    <td style={tdStyle}>{statusBadge(r.status)}</td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: "700", color: r.pointsAwarded > 0 ? "#008060" : "#9ca3af" }}>
                        {r.pointsAwarded > 0 ? `+${r.pointsAwarded}` : "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: "12px", color: "#6d7175" }}>
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
