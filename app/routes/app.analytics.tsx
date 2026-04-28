import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getDailyPoints(shop: string, days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const txs = await prisma.pointsTransaction.findMany({
    where: { shop, createdAt: { gte: since }, points: { gt: 0 } },
    select: { createdAt: true, points: true, type: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by day
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }

  for (const tx of txs) {
    const key = tx.createdAt.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + tx.points);
  }

  return Array.from(map.entries()).map(([date, points]) => ({ date, points }));
}

async function getTopCustomers(shop: string, limit: number) {
  const rows = await prisma.pointsTransaction.groupBy({
    by: ["customerId", "customerEmail", "customerName"],
    where: { shop, points: { gt: 0 } },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: limit,
  });
  return rows.map((r) => ({
    customerId: r.customerId,
    customerEmail: r.customerEmail,
    customerName: r.customerName,
    totalPoints: r._sum.points ?? 0,
  }));
}

async function getTypeBreakdown(shop: string) {
  const rows = await prisma.pointsTransaction.groupBy({
    by: ["type"],
    where: { shop },
    _sum: { points: true },
    _count: { id: true },
  });
  return rows.map((r) => ({
    type: r.type,
    totalPoints: r._sum.points ?? 0,
    count: r._count.id,
  }));
}

async function getSubmissionStats(shop: string) {
  const [total, approved, rejected, pending] = await Promise.all([
    prisma.physicalSubmission.count({ where: { shop } }),
    prisma.physicalSubmission.count({ where: { shop, status: "APPROVED" } }),
    prisma.physicalSubmission.count({ where: { shop, status: "REJECTED" } }),
    prisma.physicalSubmission.count({ where: { shop, status: "PENDING" } }),
  ]);
  return { total, approved, rejected, pending, approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0 };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [daily30, topCustomers, typeBreakdown, submissionStats, redemptionCount] = await Promise.all([
    getDailyPoints(shop, 30),
    getTopCustomers(shop, 10),
    getTypeBreakdown(shop),
    getSubmissionStats(shop),
    prisma.redemption.count({ where: { shop } }),
  ]);

  const totalEarned = typeBreakdown.filter(t => t.type !== "REDEEMED" && t.type !== "EXPIRED" && t.totalPoints > 0).reduce((s, t) => s + t.totalPoints, 0);
  const totalRedeemed = Math.abs(typeBreakdown.find(t => t.type === "REDEEMED")?.totalPoints ?? 0);
  const totalExpired = Math.abs(typeBreakdown.find(t => t.type === "EXPIRED")?.totalPoints ?? 0);

  return { daily30, topCustomers, typeBreakdown, submissionStats, redemptionCount, totalEarned, totalRedeemed, totalExpired };
};

const TYPE_LABELS: Record<string, string> = {
  EARNED_ONLINE: "Online Orders",
  EARNED_PHYSICAL: "Physical Receipts",
  EARNED_RULE: "Bonus Rules",
  MANUAL_ADJUST: "Manual Adjustments",
  REDEEMED: "Redemptions",
  EXPIRED: "Expired",
};

const TYPE_COLORS: Record<string, string> = {
  EARNED_ONLINE: "#008060",
  EARNED_PHYSICAL: "#2563eb",
  EARNED_RULE: "#7c3aed",
  MANUAL_ADJUST: "#d97706",
  REDEEMED: "#dc2626",
  EXPIRED: "#9ca3af",
};

export default function Analytics() {
  const { daily30, topCustomers, typeBreakdown, submissionStats, redemptionCount, totalEarned, totalRedeemed, totalExpired } = useLoaderData<typeof loader>();

  // Simple bar chart using CSS
  const maxPoints = Math.max(...daily30.map(d => d.points), 1);

  return (
    <s-page heading="Analytics">
      {/* KPI row */}
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
          {[
            { label: "Total Points Earned", value: totalEarned.toLocaleString(), color: "#008060" },
            { label: "Total Redeemed", value: totalRedeemed.toLocaleString(), color: "#dc2626" },
            { label: "Total Expired", value: totalExpired.toLocaleString(), color: "#9ca3af" },
            { label: "Discount Codes Issued", value: redemptionCount.toLocaleString(), color: "#2563eb" },
          ].map((k) => (
            <div key={k.label} style={{ background: "#f6f6f7", borderRadius: "8px", padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: "32px", fontWeight: "700", color: k.color }}>{k.value}</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>{k.label}</div>
            </div>
          ))}
        </div>
      </s-section>

      {/* Daily points chart — last 30 days */}
      <s-section heading="Points Earned — Last 30 Days">
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "160px", minWidth: "600px", padding: "0 4px" }}>
            {daily30.map((d) => {
              const pct = (d.points / maxPoints) * 100;
              return (
                <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                  <div
                    style={{
                      width: "100%",
                      height: `${Math.max(pct, 2)}%`,
                      background: pct > 0 ? "#008060" : "#e5e7eb",
                      borderRadius: "3px 3px 0 0",
                      minHeight: "4px",
                      transition: "height 0.2s",
                      cursor: "default",
                    }}
                    title={`${d.date}: ${d.points} pts`}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "11px", color: "#9ca3af" }}>
            <span>{daily30[0]?.date}</span>
            <span>{daily30[Math.floor(daily30.length / 2)]?.date}</span>
            <span>{daily30[daily30.length - 1]?.date}</span>
          </div>
        </div>
      </s-section>

      {/* Top customers + Type breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>
        <s-section heading="Top 10 Customers by Points">
          {topCustomers.length === 0 ? (
            <s-paragraph>No data yet.</s-paragraph>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {topCustomers.map((c, i) => {
                const pct = (c.totalPoints / topCustomers[0].totalPoints) * 100;
                return (
                  <div key={c.customerId}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
                      <span style={{ fontWeight: "500" }}>
                        <span style={{ color: "#9ca3af", marginRight: "6px" }}>#{i + 1}</span>
                        {c.customerName || c.customerEmail}
                      </span>
                      <span style={{ fontWeight: "700", color: "#008060" }}>{c.totalPoints.toLocaleString()} pts</span>
                    </div>
                    <div style={{ height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#008060", borderRadius: "3px" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </s-section>

        <s-section heading="Points by Source">
          {typeBreakdown.length === 0 ? (
            <s-paragraph>No transactions yet.</s-paragraph>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {typeBreakdown.map((t) => (
                <div key={t.type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: TYPE_COLORS[t.type] ?? "#6b7280" }} />
                    <span style={{ fontSize: "13px" }}>{TYPE_LABELS[t.type] ?? t.type}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: "700", fontSize: "14px", color: TYPE_COLORS[t.type] ?? "#374151" }}>
                      {Math.abs(t.totalPoints).toLocaleString()}
                    </span>
                    <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "6px" }}>({t.count} txns)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </s-section>
      </div>

      {/* Submission stats */}
      <s-section heading="Physical Receipt Submissions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px" }}>
          {[
            { label: "Total", value: submissionStats.total, color: "#374151" },
            { label: "Pending", value: submissionStats.pending, color: "#d97706" },
            { label: "Approved", value: submissionStats.approved, color: "#008060" },
            { label: "Rejected", value: submissionStats.rejected, color: "#dc2626" },
            { label: "Approval Rate", value: `${submissionStats.approvalRate}%`, color: "#2563eb" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: "700", color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
