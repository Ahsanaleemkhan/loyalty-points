import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { adjustPoints } from "../models/points.server";
import { Badge, EmptyState, Pagination, PageTabs, SearchBar, useToast, ToastContainer, exportCSV } from "../components/ui";
import prisma from "../db.server";
import adminStyles from "../styles/admin.css?url";

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
  const customerId   = String(formData.get("customerId"));
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
  const totalPages = Math.ceil(total / pageSize);
  const { toasts, dismiss } = useToast();

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", color: "var(--lp-text-muted)" }}>
            <strong style={{ color: "var(--lp-text)" }}>{total.toLocaleString()}</strong> customers enrolled
          </div>
          <button className="lp-btn lp-btn-secondary lp-btn-sm" type="button" onClick={handleExport}>
            ↓ Export CSV
          </button>
        </div>

        <SearchBar defaultValue={search} placeholder="Search by name or email…" />

        {fetcher.data && "success" in fetcher.data && (
          <div style={{ background: "var(--lp-green-light)", border: "1px solid #a7f3d0", borderRadius: "6px", padding: "10px 14px", color: "#065f46", fontWeight: "600", marginBottom: "12px", fontSize: "13px" }}>
            ✓ {(fetcher.data as { message: string }).message}
          </div>
        )}
        {fetcher.data && "error" in fetcher.data && (
          <div style={{ background: "var(--lp-red-light)", border: "1px solid #fca5a5", borderRadius: "6px", padding: "10px 14px", color: "#b91c1c", fontWeight: "600", marginBottom: "12px", fontSize: "13px" }}>
            {(fetcher.data as { error: string }).error}
          </div>
        )}

        {customers.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No customers found"
            subtitle={search ? `No results for "${search}". Try a different search.` : "Points are awarded automatically when orders are paid."}
            action={search ? { label: "Clear Search", onClick: () => setSearchParams({}) } : undefined}
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
