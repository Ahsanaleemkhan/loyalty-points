import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { formatMoney } from "../utils/currency";
import prisma from "../db.server";

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const search = url.searchParams.get("q") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    shop: session.shop,
    ...(status ? { status } : {}),
    ...(search ? {
      OR: [
        { customerEmail: { contains: search } },
        { customerName: { contains: search } },
        { storeLocation: { contains: search } },
      ],
    } : {}),
  };

  const [submissions, total, settings] = await Promise.all([
    prisma.physicalSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.physicalSubmission.count({ where }),
    getSettings(session.shop),
  ]);

  return { submissions, total, page, pageSize: PAGE_SIZE, settings, status, search };
};

const statusBadge = (s: string) => {
  const cfg: Record<string, { bg: string; color: string }> = {
    PENDING:  { bg: "#fef3c7", color: "#d97706" },
    APPROVED: { bg: "#d1fae5", color: "#065f46" },
    REJECTED: { bg: "#fee2e2", color: "#b91c1c" },
  };
  const c = cfg[s] ?? cfg.PENDING;
  return <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:"12px", fontSize:"12px", fontWeight:"600", background:c.bg, color:c.color }}>{s}</span>;
};

const thStyle: React.CSSProperties = { padding:"10px 14px", textAlign:"left", fontSize:"12px", fontWeight:"600", color:"#6d7175", borderBottom:"1px solid #e1e3e5", background:"#f6f6f7" };
const tdStyle: React.CSSProperties = { padding:"12px 14px", fontSize:"14px", borderBottom:"1px solid #e1e3e5" };

export default function Submissions() {
  const { submissions, total, page, pageSize, settings, status, search } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);

  return (
    <s-page heading="Physical Purchase Submissions">

      {/* Search + Filter bar */}
      <s-section>
        <Form method="get" style={{ display:"flex", gap:"10px", flexWrap:"wrap", alignItems:"center" }}>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search email, name or store…"
            style={{ padding:"8px 12px", border:"1px solid #c9cccf", borderRadius:"6px", fontSize:"14px", minWidth:"220px", flex:1 }}
          />
          <select
            name="status"
            defaultValue={status}
            style={{ padding:"8px 12px", border:"1px solid #c9cccf", borderRadius:"6px", fontSize:"14px", cursor:"pointer" }}
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <input type="hidden" name="page" value="1" />
          <button type="submit" style={{ padding:"8px 20px", background:"#008060", color:"#fff", border:"none", borderRadius:"6px", cursor:"pointer", fontWeight:"600", fontSize:"14px" }}>Search</button>
          {(search || status) && (
            <button type="button" onClick={() => setSearchParams({})} style={{ padding:"8px 16px", background:"transparent", color:"#6d7175", border:"1px solid #c9cccf", borderRadius:"6px", cursor:"pointer", fontSize:"14px" }}>
              Clear
            </button>
          )}
        </Form>
      </s-section>

      <s-section heading={`Submissions (${total} total${search ? ` matching "${search}"` : ""})`}>
        {submissions.length === 0 ? (
          <s-paragraph>No submissions found.</s-paragraph>
        ) : (
          <>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Customer</th>
                    <th style={thStyle}>Amount</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Store</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Points</th>
                    <th style={thStyle}>Submitted</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr key={s.id} style={{ background:"#fff" }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight:"500" }}>{s.customerName || "—"}</div>
                        <div style={{ fontSize:"12px", color:"#6d7175" }}>{s.customerEmail}</div>
                      </td>
                      <td style={tdStyle}>{formatMoney(s.purchaseAmount, settings.currency)}</td>
                      <td style={tdStyle}>{s.purchaseDate}</td>
                      <td style={tdStyle}>{s.storeLocation || "—"}</td>
                      <td style={tdStyle}>{statusBadge(s.status)}</td>
                      <td style={tdStyle}>{s.status === "APPROVED" ? s.pointsAwarded : "—"}</td>
                      <td style={tdStyle}>{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <Link to={`/app/submissions/${s.id}`} style={{ color:"#008060", textDecoration:"none", fontWeight:"500" }}>Review →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"16px" }}>
                <span style={{ fontSize:"13px", color:"#6d7175" }}>
                  Page {page} of {totalPages} ({total} total)
                </span>
                <div style={{ display:"flex", gap:"8px" }}>
                  {page > 1 && (
                    <button onClick={() => setSearchParams((p) => { p.set("page", String(page - 1)); return p; })}
                      style={{ padding:"6px 14px", border:"1px solid #c9cccf", borderRadius:"6px", cursor:"pointer", fontSize:"13px" }}>
                      ← Prev
                    </button>
                  )}
                  {page < totalPages && (
                    <button onClick={() => setSearchParams((p) => { p.set("page", String(page + 1)); return p; })}
                      style={{ padding:"6px 14px", border:"1px solid #c9cccf", borderRadius:"6px", cursor:"pointer", fontSize:"13px" }}>
                      Next →
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
