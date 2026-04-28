import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { adjustPoints, awardPoints } from "../models/points.server";
import { Badge, EmptyState, Pagination, PageTabs, SearchBar, useToast, ToastContainer, exportCSV } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";
import { useState } from "react";

export const links = () => [{ rel: "stylesheet", href: adminStyles }];

const PAGE_SIZE = 30;

const CUSTOMER_TABS = [
  { label: "Customers",    to: "/app/customers" },
  { label: "Transactions", to: "/app/transactions" },
  { label: "Redemptions",  to: "/app/redemptions" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    shop: session.shop,
    ...(search ? { OR: [{ customerEmail: { contains: search } }, { customerName: { contains: search } }] } : {}),
  };

  const [rows, totalGroups] = await Promise.all([
    prisma.pointsTransaction.groupBy({
      by: ["customerId", "customerEmail", "customerName"],
      where,
      _sum: { points: true },
      orderBy: { _sum: { points: "desc" } },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.pointsTransaction.groupBy({ by: ["customerId"], where }),
  ]);

  return {
    customers: rows.map((r) => ({
      customerId: r.customerId,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      pointsBalance: r._sum.points ?? 0,
    })),
    total: totalGroups.length,
    page,
    pageSize: PAGE_SIZE,
    search,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "adjust");

  // ── Manual enroll a customer ──────────────────────────────────────────────
  if (intent === "enroll") {
    const customerEmail = String(formData.get("customerEmail") || "").trim().toLowerCase();
    const customerName  = String(formData.get("customerName")  || "").trim();
    const shopifyId     = String(formData.get("shopifyId")     || "").trim();
    const initialPoints = Number(formData.get("initialPoints") || 0);

    if (!customerEmail) return { error: "Customer email is required." };
    if (isNaN(initialPoints) || initialPoints < 0) return { error: "Points must be a positive number." };

    // Build GID — use the numeric Shopify ID if provided, otherwise derive from email
    const customerId = shopifyId
      ? `gid://shopify/Customer/${shopifyId.replace(/\D/g, "")}`
      : `gid://shopify/Customer/manual_${Buffer.from(customerEmail).toString("hex")}`;

    // Check if already enrolled
    const existing = await prisma.pointsTransaction.count({
      where: { shop: session.shop, customerId },
    });
    if (existing > 0) {
      return { error: `${customerEmail} is already enrolled. Use "Adjust Points" to change their balance.` };
    }

    await awardPoints({
      shop: session.shop,
      customerId,
      customerEmail,
      customerName: customerName || customerEmail,
      points: initialPoints,
      type: "MANUAL_ADJUST",
      note: "Manual enrollment by admin",
      admin,
    });

    return { success: true, message: `✓ ${customerName || customerEmail} enrolled with ${initialPoints} points.` };
  }

  // ── Adjust points for existing customer ───────────────────────────────────
  const customerId    = String(formData.get("customerId"));
  const customerEmail = String(formData.get("customerEmail"));
  const customerName  = String(formData.get("customerName") || "");
  const pointsDelta   = Number(formData.get("pointsDelta"));
  const note          = String(formData.get("note") || "Manual adjustment");
  if (!customerId || isNaN(pointsDelta)) return { error: "Invalid input" };
  const newBalance = await adjustPoints({ shop: session.shop, customerId, customerEmail, customerName, pointsDelta, note, admin });
  return { success: true, message: `Balance updated to ${newBalance} pts`, newBalance };
};

export default function Customers() {
  const { customers, total, page, pageSize, search } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [, setSearchParams] = useSearchParams();
  const [showEnroll, setShowEnroll] = useState(false);
  const totalPages = Math.ceil(total / pageSize);
  const { toasts, dismiss } = useToast();

  const isSubmitting = fetcher.state === "submitting";
  const result = fetcher.data as any;

  // Close enroll panel on success
  const enrollSuccess = result?.success && fetcher.state === "idle" && showEnroll;

  function handleExport() {
    exportCSV(
      "customers.csv",
      ["Customer ID", "Email", "Name", "Points Balance"],
      customers.map((c) => [c.customerId, c.customerEmail, c.customerName, c.pointsBalance])
    );
  }

  return (
    <s-page heading="Customer Points">
      <ToastContainer toasts={toasts} dismiss={dismiss} />
      <PageTabs tabs={CUSTOMER_TABS} />

      <s-section>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", color: "var(--lp-text-muted)" }}>
            <strong style={{ color: "var(--lp-text)" }}>{total.toLocaleString()}</strong> customers enrolled
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="lp-btn lp-btn-primary lp-btn-sm" type="button" onClick={() => setShowEnroll(!showEnroll)}>
              {showEnroll ? "✕ Cancel" : "+ Enroll Customer"}
            </button>
            <button className="lp-btn lp-btn-secondary lp-btn-sm" type="button" onClick={handleExport}>
              ↓ Export CSV
            </button>
          </div>
        </div>

        {/* Manual enroll panel */}
        {showEnroll && (
          <div style={{ background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: "10px", padding: "18px 20px", marginBottom: "20px" }}>
            <div style={{ fontWeight: "700", fontSize: "15px", color: "#065f46", marginBottom: "14px" }}>
              ➕ Manually Enroll a Customer
            </div>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="enroll" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#374151", display: "block", marginBottom: "4px" }}>
                    Email <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    name="customerEmail"
                    type="email"
                    placeholder="customer@email.com"
                    required
                    className="lp-input"
                    style={{ width: "100%", padding: "8px 10px" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#374151", display: "block", marginBottom: "4px" }}>
                    Full Name
                  </label>
                  <input
                    name="customerName"
                    type="text"
                    placeholder="Afan Aleem"
                    className="lp-input"
                    style={{ width: "100%", padding: "8px 10px" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#374151", display: "block", marginBottom: "4px" }}>
                    Shopify Customer ID <span style={{ color: "#9ca3af", fontWeight: "400" }}>(optional — from URL)</span>
                  </label>
                  <input
                    name="shopifyId"
                    type="text"
                    placeholder="e.g. 9242473529602"
                    className="lp-input"
                    style={{ width: "100%", padding: "8px 10px" }}
                  />
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>
                    In Shopify Admin → Customers → click customer → copy ID from URL
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "600", color: "#374151", display: "block", marginBottom: "4px" }}>
                    Initial Points
                  </label>
                  <input
                    name="initialPoints"
                    type="number"
                    min="0"
                    placeholder="0"
                    className="lp-input"
                    style={{ width: "100%", padding: "8px 10px" }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="lp-btn lp-btn-primary"
                style={{ padding: "10px 24px" }}
              >
                {isSubmitting ? "⏳ Enrolling…" : "Enroll Customer"}
              </button>
            </fetcher.Form>
          </div>
        )}

        {/* Feedback messages */}
        {result?.success && (
          <div style={{ background: "var(--lp-green-light)", border: "1px solid #a7f3d0", borderRadius: "6px", padding: "10px 14px", color: "#065f46", fontWeight: "600", marginBottom: "12px", fontSize: "13px" }}>
            ✓ {result.message}
          </div>
        )}
        {result?.error && (
          <div style={{ background: "var(--lp-red-light)", border: "1px solid #fca5a5", borderRadius: "6px", padding: "10px 14px", color: "#b91c1c", fontWeight: "600", marginBottom: "12px", fontSize: "13px" }}>
            ✕ {result.error}
          </div>
        )}

        <SearchBar defaultValue={search} placeholder="Search by name or email…" />

        {customers.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No customers enrolled yet"
            subtitle={search
              ? `No results for "${search}". Try a different search.`
              : "Click \"+ Enroll Customer\" to add customers manually, or points are awarded automatically when orders are paid."}
            action={search ? { label: "Clear Search", onClick: () => setSearchParams({}) } : { label: "+ Enroll Customer", onClick: () => setShowEnroll(true) }}
          />
        ) : (
          <>
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Balance</th>
                    <th>Adjust Points</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.customerId}>
                      <td>
                        <div style={{ fontWeight: "600" }}>{c.customerName || "—"}</div>
                        <div style={{ fontSize: "12px", color: "var(--lp-text-muted)" }}>{c.customerEmail}</div>
                      </td>
                      <td>
                        <span style={{ fontWeight: "800", fontSize: "18px", color: c.pointsBalance >= 0 ? "var(--lp-green)" : "var(--lp-red)" }}>
                          {c.pointsBalance.toLocaleString()}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--lp-text-muted)", marginLeft: "4px" }}>pts</span>
                      </td>
                      <td>
                        <fetcher.Form method="post" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <input type="hidden" name="intent"        value="adjust" />
                          <input type="hidden" name="customerId"    value={c.customerId} />
                          <input type="hidden" name="customerEmail" value={c.customerEmail} />
                          <input type="hidden" name="customerName"  value={c.customerName} />
                          <input
                            name="pointsDelta"
                            type="number"
                            placeholder="+/−"
                            className="lp-input"
                            style={{ width: "72px", padding: "6px 8px" }}
                            required
                          />
                          <input
                            name="note"
                            type="text"
                            placeholder="Reason"
                            className="lp-input"
                            style={{ width: "120px", padding: "6px 8px" }}
                          />
                          <button type="submit" className="lp-btn lp-btn-primary lp-btn-sm">Apply</button>
                        </fetcher.Form>
                      </td>
                      <td>
                        <Link
                          to={`/app/customers/${encodeURIComponent(c.customerId)}`}
                          className="lp-btn lp-btn-secondary lp-btn-sm"
                          style={{ textDecoration: "none", marginRight: "6px" }}
                        >
                          View
                        </Link>
                        <Link
                          to={`/app/transactions?customerId=${encodeURIComponent(c.customerId)}`}
                          className="lp-btn lp-btn-secondary lp-btn-sm"
                          style={{ textDecoration: "none" }}
                        >
                          History
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} />
          </>
        )}
      </s-section>

      {/* Why customers are missing — info box */}
      <s-section heading="Why aren't all my Shopify customers here?">
        <div style={{ fontSize: "13px", color: "#374151", lineHeight: "1.8" }}>
          <p style={{ margin: "0 0 10px" }}>
            This app only tracks customers who have earned points <strong>after the app was installed</strong>.
            Existing orders placed before installation don't automatically appear here.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong>To add existing customers:</strong> Click <strong>"+ Enroll Customer"</strong> above, enter their email and name.
            You can also enter their Shopify Customer ID (found in the URL when viewing a customer in Shopify Admin)
            and set their initial points balance based on past spend.
          </p>
          <p style={{ margin: 0, color: "#6b7280" }}>
            Going forward, all new paid orders will automatically earn points via webhook.
          </p>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
