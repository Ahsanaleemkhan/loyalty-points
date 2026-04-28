import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopStats } from "../models/transactions.server";
import { getSettings } from "../models/settings.server";
import { formatMoney } from "../utils/currency";
import { StatCard, HealthScore, ProgressBar } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [stats, settings, recentTx, redemptionCount, referralConverted] = await Promise.all([
    getShopStats(shop),
    getSettings(shop),
    prisma.pointsTransaction.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, customerName: true, customerEmail: true, type: true, points: true, createdAt: true, note: true },
    }),
    prisma.redemption.count({ where: { shop } }),
    prisma.referral.count({ where: { shop, status: "CONVERTED" } }),
  ]);

  // Program Health Score (0–100)
  // Factors: customers active, redemption usage, expiry configured, tiers enabled, email enabled
  let health = 0;
  if (stats.uniqueCustomers > 0)       health += 20;
  if (stats.uniqueCustomers >= 10)     health += 10;
  if (redemptionCount > 0)             health += 20;
  if (settings.pointsExpiryDays > 0)  health += 15;
  if (settings.tiersEnabled)           health += 15;
  if (settings.emailEnabled)           health += 10;
  if (referralConverted > 0)           health += 10;

  // Setup checklist
  const checklist = [
    { label: "Points system enabled",       done: settings.isEnabled },
    { label: "Redemptions configured",      done: settings.redemptionEnabled },
    { label: "At least one customer enrolled", done: stats.uniqueCustomers > 0 },
    { label: "Email notifications on",      done: settings.emailEnabled },
    { label: "VIP tiers active",            done: settings.tiersEnabled },
    { label: "Points expiry set",           done: settings.pointsExpiryDays > 0 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return { stats, settings, recentTx, health, checklist, doneCount, redemptionCount };
};

const TX_TYPE: Record<string, { label: string; color: string }> = {
  EARNED_ONLINE:   { label: "Online Purchase", color: "#008060" },
  EARNED_PHYSICAL: { label: "Physical Receipt", color: "#2563eb" },
  EARNED_RULE:     { label: "Bonus Points",    color: "#7c3aed" },
  MANUAL_ADJUST:   { label: "Manual Adjust",   color: "#d97706" },
  REDEEMED:        { label: "Redeemed",        color: "#dc2626" },
  EXPIRED:         { label: "Expired",         color: "#9ca3af" },
};

export default function Dashboard() {
  const { stats, settings, recentTx, health, checklist, doneCount, redemptionCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Loyalty Dashboard">
      {/* ── KPI Row ── */}
      <s-section>
        <div className="lp-stat-grid">
          <StatCard label="Total Points Awarded"  value={stats.totalPointsAwarded} color="#008060" icon="⭐" />
          <StatCard label="Enrolled Customers"     value={stats.uniqueCustomers}    color="#2563eb" icon="👥" />
          <StatCard label="Pending Submissions"    value={stats.pendingSubmissions}  color="#d97706" icon="📋" animate={false} />
          <StatCard label="Points This Month"      value={stats.pointsThisMonth}    color="#7c3aed" icon="📈" />
        </div>
      </s-section>

      {/* ── Secondary stats ── */}
      <s-section>
        <div className="lp-stat-grid">
          <StatCard label="Total Transactions"  value={stats.totalTransactions} color="#374151" icon="🔄" />
          <StatCard label="Redemptions Issued"  value={redemptionCount}         color="#059669" icon="🎟️" />
        </div>
      </s-section>

      {/* ── Program Health + Checklist ── */}
      <s-section heading="Program Health">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Health score */}
          <div>
            <HealthScore score={health} />
            <p style={{ fontSize: "13px", color: "var(--lp-text-muted)", marginTop: "10px", lineHeight: 1.5 }}>
              Based on setup completeness, customer engagement, and feature adoption.
            </p>
          </div>

          {/* Setup checklist */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600" }}>Setup Checklist</span>
              <span style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{doneCount}/{checklist.length} done</span>
            </div>
            <ProgressBar value={doneCount} max={checklist.length} />
            <ul className="lp-checklist" style={{ marginTop: "12px" }}>
              {checklist.map((c) => (
                <li key={c.label} className={`lp-check-item ${c.done ? "done" : "todo"}`}>
                  <span className="lp-check-icon">{c.done ? "✅" : "⬜"}</span>
                  <span style={{ fontSize: "13px" }}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </s-section>

      {/* ── Recent Activity ── */}
      <s-section heading="Recent Activity">
        {recentTx.length === 0 ? (
          <div className="lp-empty">
            <div className="lp-empty-icon">🌱</div>
            <div className="lp-empty-title">No activity yet</div>
            <p className="lp-empty-sub">Points will appear here once customers start earning. Make sure to add the Loyalty Widget to your theme.</p>
            <Link to="/app/settings" className="lp-btn lp-btn-primary" style={{ display: "inline-flex" }}>Configure Settings</Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {recentTx.map((tx) => {
              const t = TX_TYPE[tx.type] ?? { label: tx.type, color: "#374151" };
              return (
                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 4px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.customerName || tx.customerEmail}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--lp-text-muted)" }}>{t.label} · {new Date(tx.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                  <span style={{ fontWeight: "700", color: tx.points >= 0 ? "#008060" : "#dc2626", fontSize: "14px", flexShrink: 0, marginLeft: "12px" }}>
                    {tx.points >= 0 ? "+" : ""}{tx.points} pts
                  </span>
                </div>
              );
            })}
            <div style={{ marginTop: "12px" }}>
              <Link to="/app/transactions" className="lp-btn lp-btn-secondary lp-btn-sm">View All Transactions →</Link>
            </div>
          </div>
        )}
      </s-section>

      {/* ── Aside ── */}
      <s-section heading="Current Configuration" slot="aside">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
          {[
            { label: "Earning Rate", value: `${settings.pointsPerAmount} pts / ${formatMoney(settings.amountPerPoints, settings.currency)}` },
            { label: "Min Purchase", value: settings.minPurchaseAmount > 0 ? formatMoney(settings.minPurchaseAmount, settings.currency) : "None" },
            { label: "Expiry", value: settings.pointsExpiryDays > 0 ? `${settings.pointsExpiryDays} days` : "Never" },
            { label: "Currency", value: settings.currency },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--lp-border)" }}>
              <span style={{ color: "var(--lp-text-muted)" }}>{row.label}</span>
              <span style={{ fontWeight: "600" }}>{row.value}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0" }}>
            <span style={{ color: "var(--lp-text-muted)" }}>Status</span>
            <span className={`lp-badge ${settings.isEnabled ? "lp-badge-green" : "lp-badge-red"}`}>
              {settings.isEnabled ? "Active" : "Disabled"}
            </span>
          </div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <Link to="/app/settings" className="lp-btn lp-btn-primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>Edit Settings</Link>
        </div>
      </s-section>

      <s-section heading="Quick Actions" slot="aside">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { label: "📋 Review Submissions", to: "/app/submissions" },
            { label: "👥 Manage Customers",   to: "/app/customers" },
            { label: "🎟️ View Redemptions",  to: "/app/redemptions" },
            { label: "🏆 Configure Tiers",   to: "/app/tiers" },
            { label: "📊 Analytics",         to: "/app/analytics" },
          ].map((a) => (
            <Link key={a.to} to={a.to} className="lp-btn lp-btn-secondary" style={{ textDecoration: "none", justifyContent: "flex-start" }}>
              {a.label}
            </Link>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
