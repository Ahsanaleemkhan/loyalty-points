import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getTransactions } from "../models/transactions.server";
import { Badge, EmptyState, PageTabs, exportCSV } from "../components/ui";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") || undefined;
  const typeFilter = url.searchParams.get("type") || "";
  const transactions = await getTransactions(session.shop, customerId);
  const filtered = typeFilter ? transactions.filter((t) => t.type === typeFilter) : transactions;
  return { transactions: filtered, customerId, typeFilter, allCount: transactions.length };
};

const CUSTOMER_TABS = [
  { label: "Customers",    to: "/app/customers" },
  { label: "Transactions", to: "/app/transactions" },
  { label: "Redemptions",  to: "/app/redemptions" },
];

const TYPE_OPTIONS = [
  { value: "",               label: "All Types" },
  { value: "EARNED_ONLINE",  label: "Online Purchase" },
  { value: "EARNED_PHYSICAL",label: "Physical Receipt" },
  { value: "EARNED_RULE",    label: "Bonus Points" },
  { value: "MANUAL_ADJUST",  label: "Manual Adjustment" },
  { value: "REDEEMED",       label: "Redeemed" },
  { value: "EXPIRED",        label: "Expired" },
];

export default function Transactions() {
  const { transactions, customerId, typeFilter, allCount } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  function handleExport() {
    exportCSV(
      "transactions.csv",
      ["ID", "Customer", "Email", "Type", "Points", "Note", "Date"],
      transactions.map((t) => [t.id, t.customerName, t.customerEmail, t.type, t.points, t.note, new Date(t.createdAt).toISOString()])
    );
  }

  return (
    <s-page heading={customerId ? "Customer Transaction History" : "All Transactions"}>
      <PageTabs tabs={CUSTOMER_TABS} />
      <s-section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {customerId && (
              <button className="lp-btn lp-btn-secondary lp-btn-sm" onClick={() => setSearchParams({})}>
                ← All Transactions
              </button>
            )}
            <select
              className="lp-input"
              style={{ width: "auto", padding: "7px 12px", fontSize: "13px" }}
              value={typeFilter}
              onChange={(e) => setSearchParams((p) => { e.target.value ? p.set("type", e.target.value) : p.delete("type"); return p; })}
            >
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span style={{ fontSize: "13px", color: "var(--lp-text-muted)" }}>
              {transactions.length}{typeFilter ? ` of ${allCount}` : ""} records
            </span>
          </div>
          <button className="lp-btn lp-btn-secondary lp-btn-sm" type="button" onClick={handleExport}>
            ↓ Export CSV
          </button>
        </div>

        {transactions.length === 0 ? (
          <EmptyState icon="🔄" title="No transactions found" subtitle={typeFilter ? "Try clearing the filter." : "Transactions appear here as customers earn and redeem points."} />
        ) : (
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Points</th>
                  <th>Note</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <div style={{ fontWeight: "600" }}>{tx.customerName || "—"}</div>
                      <div style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{tx.customerEmail}</div>
                    </td>
                    <td><Badge type={tx.type} /></td>
                    <td>
                      <span style={{ fontWeight: "800", color: tx.points >= 0 ? "var(--lp-green)" : "var(--lp-red)", fontSize: "15px" }}>
                        {tx.points >= 0 ? "+" : ""}{tx.points.toLocaleString()}
                      </span>
                    </td>
                    <td style={{ maxWidth: "240px", fontSize: "13px", color: "var(--lp-text-muted)" }} title={tx.note}>
                      {tx.note || "—"}
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--lp-text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(tx.createdAt).toLocaleString()}
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
