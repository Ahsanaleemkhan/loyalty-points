import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopStats } from "../models/transactions.server";
import { getSettings } from "../models/settings.server";
import { formatMoney } from "../utils/currency";
import { StatCard, HealthScore, ProgressBar } from "../components/ui";
import { getActivePlanForShop, getPlanSummary } from "../utils/plan-limits.server";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const { tier } = await getActivePlanForShop(shop);
  const planSummary = await getPlanSummary(shop, tier);

  // ── Install state detection ───────────────────────────────────────────────
  // Check if merchant is returning (previously uninstalled within 90 days)
  const appSettingsRaw = await prisma.appSettings.findUnique({ where: { shop } });
  const isReturningMerchant = !!(appSettingsRaw?.uninstalledAt);

  // Clear the uninstalledAt flag now that they're back — do this before other queries
  if (isReturningMerchant) {
    await prisma.appSettings.update({
      where: { shop },
      data: { uninstalledAt: null },
    }).catch(() => {});
  }

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

  // Is this a brand-new install? (no transactions AND not a returning merchant)
  const isNewInstall = !isReturningMerchant && stats.totalTransactions === 0;

  // ── Program Health Score (0–100) ─────────────────────────────────────────
  // 60 pts come from the 6 setup-checklist items (10 pts each) so completing
  // the checklist always maps cleanly to 60/100. The remaining 40 pts come
  // from engagement (active customers, redemptions, referrals).
  const factors = [
    // Setup factors (60 pts total — mirrors the 6-step checklist)
    { key: "enabled",     label: "Points system enabled",        points: 10, earned: settings.isEnabled,                  group: "setup" as const, hint: "Turn on the points system in Settings." },
    { key: "redemption",  label: "Redemptions configured",       points: 10, earned: settings.redemptionEnabled,          group: "setup" as const, hint: "Enable redemptions in Settings → Redemption Settings." },
    { key: "customer",    label: "At least one customer enrolled", points: 10, earned: stats.uniqueCustomers > 0,         group: "setup" as const, hint: "Enroll a customer manually or wait for a paid order." },
    { key: "email",       label: "Email notifications on",       points: 10, earned: settings.emailEnabled,               group: "setup" as const, hint: "Enable email notifications in Settings." },
    { key: "tiers",       label: "VIP tiers active",             points: 10, earned: settings.tiersEnabled,               group: "setup" as const, hint: "Turn on VIP tiers from the Tiers page." },
    { key: "expiry",      label: "Points expiry set",            points: 10, earned: settings.pointsExpiryDays > 0,       group: "setup" as const, hint: "Set Points Expiry (days) in Settings — even 365 days counts." },
    // Engagement factors (40 pts total — earned over time, not part of setup)
    { key: "scale",       label: "10+ customers enrolled",       points: 15, earned: stats.uniqueCustomers >= 10,         group: "engagement" as const, hint: "Promote your loyalty program — share the rewards page link with customers." },
    { key: "redeemed",    label: "At least 1 redemption made",   points: 15, earned: redemptionCount > 0,                 group: "engagement" as const, hint: "Customers earn this when they redeem points for a discount code." },
    { key: "referral",    label: "Referral converted",           points: 10, earned: referralConverted > 0,               group: "engagement" as const, hint: "Earned when a referred friend places their first paid order." },
  ];
  const health = factors.reduce((sum, f) => sum + (f.earned ? f.points : 0), 0);

  // Setup checklist — exactly mirrors the 6 setup factors above (60 pts total)
  const checklist = factors
    .filter((f) => f.group === "setup")
    .map((f) => ({ label: f.label, done: f.earned }));
  const doneCount = checklist.filter((c) => c.done).length;

  return { stats, settings, recentTx, health, factors, checklist, doneCount, redemptionCount, planSummary, isNewInstall, isReturningMerchant };
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
  const { stats, settings, recentTx, health, factors, checklist, doneCount, redemptionCount, planSummary, isNewInstall, isReturningMerchant } = useLoaderData<typeof loader>();
  const setupFactors      = factors.filter((f) => f.group === "setup");
  const engagementFactors = factors.filter((f) => f.group === "engagement");
  const setupEarned       = setupFactors.reduce((s, f) => s + (f.earned ? f.points : 0), 0);
  const engagementEarned  = engagementFactors.reduce((s, f) => s + (f.earned ? f.points : 0), 0);

  return (
    <s-page heading="Loyalty Dashboard">

      {/* ── Welcome Back Banner (returning merchant who reinstalled) ── */}
      {isReturningMerchant && (
        <s-section>
          <div style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "1px solid #6ee7b7", borderRadius: "12px", padding: "20px 24px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "32px" }}>🎉</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "800", fontSize: "17px", color: "#065f46", marginBottom: "6px" }}>Welcome back! Your data is right where you left it.</div>
              <div style={{ fontSize: "14px", color: "#047857", lineHeight: "1.6", marginBottom: "14px" }}>
                All your customers, points history, redemptions, and settings have been preserved.
                Your loyalty program is ready to go — no setup needed.
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: "700", color: "#065f46" }}>
                  👥 {stats.uniqueCustomers.toLocaleString()} customers retained
                </div>
                <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: "700", color: "#065f46" }}>
                  🏆 {stats.totalPointsAwarded.toLocaleString()} points on record
                </div>
                <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: "700", color: "#065f46" }}>
                  🎟️ {redemptionCount.toLocaleString()} redemptions preserved
                </div>
              </div>
            </div>
          </div>
        </s-section>
      )}

      {/* ── New Install Banner (brand new shop, no orders yet) ── */}
      {isNewInstall && (
        <s-section>
          <div style={{ background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", border: "1px solid #93c5fd", borderRadius: "12px", padding: "20px 24px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "32px" }}>🚀</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "800", fontSize: "17px", color: "#1e40af", marginBottom: "6px" }}>Welcome! Let's set up your loyalty program.</div>
              <div style={{ fontSize: "14px", color: "#1d4ed8", lineHeight: "1.6", marginBottom: "16px" }}>
                You have existing customers and orders in Shopify. Sync them now to give your customers their earned points automatically — no one starts from zero.
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <Link to="/app/sync-orders" style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#1d4ed8", color: "#fff", borderRadius: "8px", padding: "10px 18px", fontWeight: "700", fontSize: "14px", textDecoration: "none" }}>
                  🔄 Sync Existing Orders → Assign Points
                </Link>
                <Link to="/app/settings" style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.8)", color: "#1e40af", borderRadius: "8px", padding: "10px 18px", fontWeight: "700", fontSize: "14px", textDecoration: "none", border: "1px solid #93c5fd" }}>
                  ⚙️ Configure Settings First
                </Link>
              </div>
              <div style={{ fontSize: "12px", color: "#3b82f6", marginTop: "10px" }}>
                💡 New paid orders will earn points automatically via webhook — no manual sync needed going forward.
              </div>
            </div>
          </div>
        </s-section>
      )}
      {/* ── Plan Usage Banner ── */}
      {planSummary.usagePercent >= 80 && (
        <s-section>
          <div style={{
            background: planSummary.usagePercent >= 100 ? "#fee2e2" : "#fef3c7",
            border: `1px solid ${planSummary.usagePercent >= 100 ? "#dc2626" : "#d97706"}`,
            borderRadius: "8px", padding: "14px 18px",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px",
          }}>
            <div>
              <div style={{ fontWeight: 700, color: planSummary.usagePercent >= 100 ? "#b91c1c" : "#92400e" }}>
                {planSummary.usagePercent >= 100
                  ? "⛔ Monthly order limit reached — points paused"
                  : `⚠️ ${planSummary.usagePercent}% of monthly order limit used`}
              </div>
              <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
                {planSummary.ordersUsedThisMonth} / {planSummary.monthlyOrderLimit} orders this month on the <strong>{planSummary.tier}</strong> plan.
                {planSummary.usagePercent >= 100 ? " Upgrade to resume awarding points." : ` ${planSummary.ordersRemaining} orders remaining.`}
              </div>
            </div>
            <Link to="/app/billing" className="lp-btn lp-btn-primary" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
              Upgrade Plan →
            </Link>
          </div>
        </s-section>
      )}

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
          {/* Health score + breakdown */}
          <div>
            <HealthScore score={health} />
            <p style={{ fontSize: "13px", color: "var(--lp-text-muted)", marginTop: "10px", lineHeight: 1.5 }}>
              Setup gives up to <strong>60 pts</strong> · engagement gives up to <strong>40 pts</strong>. Hover any item to see how to earn it.
            </p>

            {/* Setup breakdown */}
            <div style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: "700", color: "var(--lp-text)", marginBottom: "8px" }}>
                <span>⚙️ Setup</span>
                <span style={{ color: "var(--lp-text-muted)" }}>{setupEarned}/60 pts</span>
              </div>
              {setupFactors.map((f) => (
                <div key={f.key} title={f.hint} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: "12px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", color: f.earned ? "var(--lp-text)" : "var(--lp-text-muted)" }}>
                    <span>{f.earned ? "✅" : "⬜"}</span>
                    {f.label}
                  </span>
                  <span style={{ fontWeight: "700", color: f.earned ? "#008060" : "#9ca3af" }}>
                    {f.earned ? `+${f.points}` : `0/${f.points}`} pts
                  </span>
                </div>
              ))}
            </div>

            {/* Engagement breakdown */}
            <div style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: "700", color: "var(--lp-text)", marginBottom: "8px" }}>
                <span>📈 Engagement</span>
                <span style={{ color: "var(--lp-text-muted)" }}>{engagementEarned}/40 pts</span>
              </div>
              {engagementFactors.map((f) => (
                <div key={f.key} title={f.hint} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: "12px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", color: f.earned ? "var(--lp-text)" : "var(--lp-text-muted)" }}>
                    <span>{f.earned ? "✅" : "⬜"}</span>
                    {f.label}
                  </span>
                  <span style={{ fontWeight: "700", color: f.earned ? "#008060" : "#9ca3af" }}>
                    {f.earned ? `+${f.points}` : `0/${f.points}`} pts
                  </span>
                </div>
              ))}
            </div>
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
            {doneCount === checklist.length && health < 100 && (
              <div style={{ marginTop: "14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "12px 14px", fontSize: "12px", color: "#1e40af", lineHeight: 1.6 }}>
                ✨ <strong>Setup complete!</strong> The remaining {100 - health} pts come from real customer activity — get to 10+ customers, your first redemption, and your first referral conversion to reach 100/100.
              </div>
            )}
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
