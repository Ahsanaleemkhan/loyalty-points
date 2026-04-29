import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { adjustPoints } from "../models/points.server";
import { getCustomerPointsBalance, getTransactions } from "../models/transactions.server";
import { getSettings } from "../models/settings.server";
import { getTiers, resolveCustomerTier } from "../models/tiers.server";
import { getGroupShops } from "../models/storeSync.server";
import { Badge, StatCard, ProgressBar, CodeWithCopy, EmptyState, exportCSV } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const customerId = decodeURIComponent(params.id!);
  const shop = session.shop;

  // Resolve cross-store balance if this shop is in a group
  const groupShops = await getGroupShops(shop);
  const [balance, transactions, submissions, redemptions, settings, tiers] = await Promise.all([
    getCustomerPointsBalance(shop, customerId), // start with per-shop; override below if in group
    getTransactions(shop, customerId),
    prisma.physicalSubmission.findMany({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, purchaseAmount: true, purchaseDate: true, storeLocation: true, pointsAwarded: true, createdAt: true },
    }),
    prisma.redemption.findMany({
      where: { shop, customerId },
      orderBy: { createdAt: "desc" },
    }),
    getSettings(shop),
    getTiers(shop),
  ]);

  const customerName  = transactions[0]?.customerName ?? "";
  const customerEmail = transactions[0]?.customerEmail ?? "";

  // Cross-store: override balance with group-wide total (matched by email)
  const crossStoreBalance = groupShops.length > 1 && customerEmail
    ? await prisma.pointsTransaction.aggregate({
        where: { shop: { in: groupShops }, customerEmail },
        _sum: { points: true },
      }).then((r) => r._sum.points ?? 0)
    : balance;

  // Lifetime earned (positive transactions only)
  const lifetimeEarned = transactions.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0);
  const totalRedeemed  = Math.abs(transactions.filter((t) => t.type === "REDEEMED").reduce((s, t) => s + t.points, 0));
  const tier           = settings.tiersEnabled ? resolveCustomerTier(lifetimeEarned, tiers) : null;

  // Next tier
  const sortedTiers = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  const nextTier    = sortedTiers.find((t) => lifetimeEarned < t.minPoints) ?? null;
  const tierProgress = nextTier ? Math.min((lifetimeEarned / nextTier.minPoints) * 100, 100) : 100;

  return {
    customerId, customerName, customerEmail,
    crossStoreBalance,
    isInGroup: groupShops.length > 1,
    balance, lifetimeEarned, totalRedeemed,
    transactions, submissions, redemptions,
    settings, tier, nextTier, tierProgress,
    submissionCount: submissions.length,
    redemptionCount: redemptions.length,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const customerId = decodeURIComponent(params.id!);
  const formData   = await request.formData();
  const pointsDelta = Number(formData.get("pointsDelta"));
  const note        = String(formData.get("note") || "Manual adjustment");

  const tx = await prisma.pointsTransaction.findFirst({ where: { shop: session.shop, customerId } });
  if (!tx) return { error: "Customer not found" };

  const newBalance = await adjustPoints({
    shop: session.shop, customerId,
    customerEmail: tx.customerEmail,
    customerName: tx.customerName,
    pointsDelta, note, admin,
  });
  return { success: true, newBalance };
};

export default function CustomerDetail() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const { customerId, customerName, customerEmail, balance, lifetimeEarned, totalRedeemed,
    transactions, submissions, redemptions, settings, tier, nextTier, tierProgress,
    submissionCount, redemptionCount } = data;

  function exportTx() {
    exportCSV("customer-transactions.csv",
      ["Type", "Points", "Note", "Date"],
      transactions.map((t) => [t.type, t.points, t.note, new Date(t.createdAt).toISOString()])
    );
  }

  return (
    <s-page heading={customerName || customerEmail || "Customer Detail"}>
      {/* ── Back ── */}
      <div style={{ marginBottom: "16px" }}>
        <Link to="/app/customers" className="lp-btn lp-btn-secondary lp-btn-sm" style={{ textDecoration: "none" }}>← Back to Customers</Link>
      </div>

      {/* ── KPI Row ── */}
      <s-section>
        <div className="lp-stat-grid">
          <StatCard label="Current Balance"  value={balance}        color="#008060" icon="⭐" />
          <StatCard label="Lifetime Earned"  value={lifetimeEarned} color="#2563eb" icon="📈" />
          <StatCard label="Total Redeemed"   value={totalRedeemed}  color="#dc2626" icon="🎟️" />
          <StatCard label="Submissions"      value={submissionCount} color="#d97706" icon="📋" animate={false} />
        </div>
      </s-section>

      {/* ── Tier + Adjust ── */}
      <s-section heading="VIP Status">
        {tier ? (
          <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px", background: "var(--lp-gray-light)", borderRadius: "var(--lp-radius)", marginBottom: "14px" }}>
            <span style={{ fontSize: "32px" }}>🏆</span>
            <div>
              <div style={{ fontWeight: "800", fontSize: "20px", color: tier.color }}>{tier.name}</div>
              <div style={{ fontSize: "13px", color: "var(--lp-text-muted)" }}>{tier.multiplier}x earning multiplier</div>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--lp-text-muted)", marginBottom: "12px" }}>VIP tiers not enabled.</p>
        )}

        {nextTier && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--lp-text-muted)", marginBottom: "6px" }}>
              <span>{lifetimeEarned.toLocaleString()} pts earned</span>
              <span>{nextTier.minPoints.toLocaleString()} pts to <strong>{nextTier.name}</strong></span>
            </div>
            <ProgressBar value={lifetimeEarned} max={nextTier.minPoints} color={nextTier.color} />
          </div>
        )}
      </s-section>

      {/* ── Manual Adjust ── */}
      <s-section heading="Adjust Points" slot="aside">
        <fetcher.Form method="post">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px", color: "var(--lp-text-muted)" }}>Points (use − to deduct)</label>
              <input name="pointsDelta" type="number" placeholder="+100 or -50" className="lp-input" required />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px", color: "var(--lp-text-muted)" }}>Reason</label>
              <input name="note" type="text" placeholder="e.g. Birthday bonus" className="lp-input" />
            </div>
            <button type="submit" className="lp-btn lp-btn-primary" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Saving…" : "Apply Adjustment"}
            </button>
          </div>
        </fetcher.Form>
        {fetcher.data && "success" in fetcher.data && (
          <div style={{ marginTop: "10px", background: "var(--lp-green-light)", borderRadius: "6px", padding: "8px 12px", fontSize: "13px", color: "#065f46", fontWeight: "600" }}>
            ✓ New balance: {(fetcher.data as { newBalance: number }).newBalance} pts
          </div>
        )}
      </s-section>

      {/* ── Customer Info ── */}
      <s-section heading="Profile" slot="aside">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
          {[
            { label: "Name",  value: customerName || "—" },
            { label: "Email", value: customerEmail },
            { label: "ID",    value: customerId.replace("gid://shopify/Customer/", "") },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--lp-border)" }}>
              <span style={{ color: "var(--lp-text-muted)" }}>{r.label}</span>
              <span style={{ fontWeight: "600", maxWidth: "180px", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </s-section>

      {/* ── Transaction History ── */}
      <s-section heading={`Transactions (${transactions.length})`}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
          <button className="lp-btn lp-btn-secondary lp-btn-sm" onClick={exportTx}>↓ Export CSV</button>
        </div>
        {transactions.length === 0 ? (
          <EmptyState icon="🔄" title="No transactions" subtitle="This customer has no points history yet." />
        ) : (
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr><th>Type</th><th>Points</th><th>Note</th><th>Date</th></tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td><Badge type={tx.type} /></td>
                    <td>
                      <span style={{ fontWeight: "800", color: tx.points >= 0 ? "var(--lp-green)" : "var(--lp-red)" }}>
                        {tx.points >= 0 ? "+" : ""}{tx.points.toLocaleString()}
                      </span>
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{tx.note || "—"}</td>
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

      {/* ── Redemptions ── */}
      {redemptions.length > 0 && (
        <s-section heading={`Discount Codes (${redemptionCount})`}>
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr><th>Code</th><th>Points Spent</th><th>Value</th><th>Status</th><th>Date</th></tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.id}>
                    <td><CodeWithCopy code={r.discountCode} /></td>
                    <td style={{ fontWeight: "700", color: "var(--lp-purple)" }}>{r.pointsSpent} pts</td>
                    <td style={{ fontWeight: "700", color: "var(--lp-green)" }}>
                      {r.discountValue.toFixed(2)} {settings.currency}
                    </td>
                    <td><Badge type={r.status} label={r.status} /></td>
                    <td style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      )}

      {/* ── Submissions ── */}
      {submissions.length > 0 && (
        <s-section heading={`Physical Submissions (${submissionCount})`}>
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr><th>Amount</th><th>Date</th><th>Store</th><th>Points</th><th>Status</th></tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: "600" }}>{s.purchaseAmount.toFixed(2)} {settings.currency}</td>
                    <td style={{ fontSize: "13px" }}>{s.purchaseDate}</td>
                    <td style={{ fontSize: "13px", color: "var(--lp-text-muted)" }}>{s.storeLocation || "—"}</td>
                    <td style={{ fontWeight: "700", color: "var(--lp-green)" }}>{s.pointsAwarded > 0 ? `+${s.pointsAwarded}` : "—"}</td>
                    <td><Badge type={s.status} label={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
