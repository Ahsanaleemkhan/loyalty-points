import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import adminPortalCss from "../styles/admin-portal.css?url";

export const links = () => [{ rel: "stylesheet", href: adminPortalCss }];

export const loader = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalShops,
    uniqueCustomers,
    pointsIssued,
    pointsRedeemed,
    totalRedemptions,
    activeShops30d,
    topShops,
    redemptionValue,
    submissionStats,
    pointsThisMonth,
  ] = await Promise.all([
    // unique installed shops
    prisma.session.groupBy({ by: ["shop"] }).then((r) => r.length),

    // unique customers (by email across all shops — no PII returned)
    prisma.pointsTransaction
      .groupBy({ by: ["customerEmail"] })
      .then((r) => r.length),

    // total points ever issued (positive)
    prisma.pointsTransaction.aggregate({
      where: { points: { gt: 0 } },
      _sum: { points: true },
    }),

    // total points redeemed
    prisma.pointsTransaction.aggregate({
      where: { type: "REDEEMED" },
      _sum: { points: true },
    }),

    // total redemption records
    prisma.redemption.count(),

    // shops with any activity in last 30 days
    prisma.pointsTransaction
      .groupBy({ by: ["shop"], where: { createdAt: { gte: thirtyDaysAgo } } })
      .then((r) => r.length),

    // top 10 shops by points issued (shop domain only — no customer data)
    prisma.pointsTransaction.groupBy({
      by: ["shop"],
      where: { points: { gt: 0 } },
      _sum: { points: true },
      _count: { customerId: true },
      orderBy: { _sum: { points: "desc" } },
      take: 10,
    }),

    // total discount value issued
    prisma.redemption.aggregate({ _sum: { discountValue: true } }),

    // receipt submissions by status
    prisma.physicalSubmission.groupBy({
      by: ["status"],
      _count: { id: true },
    }),

    // points issued in last 30 days
    prisma.pointsTransaction.aggregate({
      where: { points: { gt: 0 }, createdAt: { gte: thirtyDaysAgo } },
      _sum: { points: true },
    }),
  ]);

  const submissionsMap = submissionStats.reduce<Record<string, number>>(
    (acc, s) => { acc[s.status] = s._count.id; return acc; },
    {}
  );

  return {
    totalShops,
    uniqueCustomers,
    totalPointsIssued:   pointsIssued._sum.points    ?? 0,
    totalPointsRedeemed: Math.abs(pointsRedeemed._sum.points ?? 0),
    totalRedemptions,
    totalDiscountValue:  redemptionValue._sum.discountValue ?? 0,
    activeShops30d,
    pointsThisMonth: pointsThisMonth._sum.points ?? 0,
    submissions: {
      pending:  submissionsMap["PENDING"]  ?? 0,
      approved: submissionsMap["APPROVED"] ?? 0,
      rejected: submissionsMap["REJECTED"] ?? 0,
    },
    topShops: topShops.map((s) => ({
      shop:      s.shop,
      points:    s._sum.points    ?? 0,
      customers: s._count.customerId,
    })),
  };
};

export default function AdminDashboard() {
  const d = useLoaderData<typeof loader>();

  const redemptionRate =
    d.totalPointsIssued > 0
      ? Math.round((d.totalPointsRedeemed / d.totalPointsIssued) * 100)
      : 0;

  const stats = [
    { label: "Installed Shops",       value: d.totalShops,                                  icon: "🏪", color: "#6366f1" },
    { label: "Active Shops (30d)",     value: d.activeShops30d,                              icon: "⚡", color: "#22c55e" },
    { label: "Unique Customers",       value: d.uniqueCustomers.toLocaleString(),            icon: "👥", color: "#06b6d4" },
    { label: "Points Issued (Total)",  value: d.totalPointsIssued.toLocaleString(),          icon: "⭐", color: "#f59e0b" },
    { label: "Points This Month",      value: d.pointsThisMonth.toLocaleString(),            icon: "📈", color: "#a78bfa" },
    { label: "Total Redemptions",      value: d.totalRedemptions.toLocaleString(),           icon: "🎟️", color: "#ec4899" },
  ];

  return (
    <>
      <div className="ap-page-title">Platform Dashboard</div>

      {/* Stat cards */}
      <div className="ap-stats">
        {stats.map((s) => (
          <div key={s.label} className="ap-stat" style={{ borderTopColor: s.color }}>
            <div style={{ fontSize: "22px", marginBottom: "8px" }}>{s.icon}</div>
            <div className="ap-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="ap-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Platform summary */}
      <div className="ap-card">
        <div className="ap-section-title">Platform Summary</div>
        <div className="ap-summary-grid">
          {[
            { label: "Redemption Rate",          value: `${redemptionRate}%` },
            { label: "Total Discount Value",      value: `$${d.totalDiscountValue.toFixed(2)}` },
            { label: "Avg Points / Customer",     value: d.uniqueCustomers > 0 ? Math.round(d.totalPointsIssued / d.uniqueCustomers).toLocaleString() : "0" },
            { label: "Active / Installed Ratio",  value: d.totalShops > 0 ? `${Math.round((d.activeShops30d / d.totalShops) * 100)}%` : "0%" },
          ].map((item) => (
            <div key={item.label} className="ap-summary-item">
              <div className="ap-summary-item-label">{item.label}</div>
              <div className="ap-summary-item-value">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Receipt submissions */}
      <div className="ap-card">
        <div className="ap-section-title">Receipt Submissions</div>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          {[
            { label: "Pending Review", value: d.submissions.pending,  cls: "ap-badge-amber"  },
            { label: "Approved",       value: d.submissions.approved, cls: "ap-badge-green"  },
            { label: "Rejected",       value: d.submissions.rejected, cls: "ap-badge-purple" },
          ].map((item) => (
            <div key={item.label} style={{ textAlign: "center", minWidth: "100px" }}>
              <div style={{ fontSize: "32px", fontWeight: "800", color: "#f1f5f9" }}>{item.value}</div>
              <span className={`ap-badge ${item.cls}`} style={{ marginTop: "6px" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top shops */}
      <div className="ap-card">
        <div className="ap-section-title">Top Shops by Points Issued</div>
        <table className="ap-table">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>#</th>
              <th>Shop Domain</th>
              <th>Unique Customers</th>
              <th>Points Issued</th>
            </tr>
          </thead>
          <tbody>
            {d.topShops.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "#64748b", padding: "24px" }}>
                  No data yet — install the app on a store to see stats here.
                </td>
              </tr>
            )}
            {d.topShops.map((shop, i) => (
              <tr key={shop.shop}>
                <td style={{ color: "#64748b" }}>{i + 1}</td>
                <td style={{ fontWeight: 600, color: "#f1f5f9" }}>{shop.shop}</td>
                <td><span className="ap-badge ap-badge-blue">{shop.customers}</span></td>
                <td><span className="ap-badge ap-badge-purple">{shop.points.toLocaleString()} pts</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
