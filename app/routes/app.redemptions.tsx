import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getRedemptions } from "../models/redemption.server";
import { getSettings } from "../models/settings.server";
import { formatMoney } from "../utils/currency";
import { StatCard, Badge, EmptyState, CodeWithCopy, PageTabs, exportCSV } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [redemptions, settings] = await Promise.all([
    getRedemptions(session.shop),
    getSettings(session.shop),
  ]);
  return { redemptions, settings };
};

const CUSTOMER_TABS = [
  { label: "Customers",    to: "/app/customers" },
  { label: "Transactions", to: "/app/transactions" },
  { label: "Redemptions",  to: "/app/redemptions" },
];

export default function Redemptions() {
  const { redemptions, settings } = useLoaderData<typeof loader>();
  const totalPointsSpent   = redemptions.reduce((s, r) => s + r.pointsSpent, 0);
  const totalDiscountValue = redemptions.reduce((s, r) => s + r.discountValue, 0);
  const activeCount        = redemptions.filter((r) => r.status === "ACTIVE").length;

  function handleExport() {
    exportCSV(
      "redemptions.csv",
      ["Customer", "Email", "Code", "Points Spent", "Discount Value", "Status", "Date"],
      redemptions.map((r) => [r.customerName, r.customerEmail, r.discountCode, r.pointsSpent, r.discountValue, r.status, new Date(r.createdAt).toISOString()])
    );
  }

  return (
    <s-page heading="Redemptions">
      <PageTabs tabs={CUSTOMER_TABS} />
      <s-section>
        <div className="lp-stat-grid">
          <StatCard label="Total Redemptions"   value={redemptions.length}  color="#008060" icon="🎟️" />
          <StatCard label="Points Spent"        value={totalPointsSpent}    color="#7c3aed" icon="⭐" />
          <StatCard label="Active Codes"        value={activeCount}         color="#d97706" icon="🔑" animate={false} />
          <StatCard label="Discounts Issued"    value={formatMoney(totalDiscountValue, settings.currency)} color="#2563eb" icon="💰" animate={false} />
        </div>
      </s-section>

      <s-section heading="Redemption Rate" slot="aside">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
          {[
            { label: "Rate", value: `${settings.pointsPerDiscount} pts = ${formatMoney(settings.discountValue, settings.currency)}` },
            { label: "Minimum", value: `${settings.minPointsRedeem} pts` },
            { label: "Status", value: settings.redemptionEnabled ? "Enabled" : "Disabled" },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--lp-border)" }}>
              <span style={{ color: "var(--lp-text-muted)" }}>{r.label}</span>
              <span style={{ fontWeight: "600" }}>{r.value}</span>
            </div>
          ))}
        </div>
        <Link to="/app/settings" className="lp-btn lp-btn-secondary lp-btn-sm" style={{ textDecoration: "none", marginTop: "12px", display: "inline-flex" }}>Edit Settings</Link>
      </s-section>

      <s-section heading={`All Codes (${redemptions.length})`}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button className="lp-btn lp-btn-secondary lp-btn-sm" type="button" onClick={handleExport}>↓ Export CSV</button>
        </div>

        {redemptions.length === 0 ? (
          <EmptyState icon="🎟️" title="No redemptions yet" subtitle="When customers redeem points for discount codes, they will appear here." />
        ) : (
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Discount Code</th>
                  <th>Points Spent</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: "600" }}>{r.customerName || "—"}</div>
                      <div style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{r.customerEmail}</div>
                    </td>
                    <td><CodeWithCopy code={r.discountCode} /></td>
                    <td>
                      <span style={{ fontWeight: "700", color: "var(--lp-purple)" }}>{r.pointsSpent.toLocaleString()} pts</span>
                    </td>
                    <td style={{ fontWeight: "700", color: "var(--lp-green)" }}>
                      {formatMoney(r.discountValue, settings.currency)}
                    </td>
                    <td><Badge type={r.status} label={r.status} /></td>
                    <td style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>
                      {new Date(r.createdAt).toLocaleDateString()}
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
