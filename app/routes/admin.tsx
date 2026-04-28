import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, Outlet, redirect, useLocation } from "react-router";
import { parseAdminCookie, verifySession } from "../utils/admin-auth.server";
import adminPortalCss from "../styles/admin-portal.css?url";

export const links = () => [{ rel: "stylesheet", href: adminPortalCss }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Don't auth-guard the login page itself — that would cause an infinite redirect
  if (url.pathname === "/admin/login" || url.pathname === "/admin/logout") return null;
  const token = parseAdminCookie(request.headers.get("Cookie"));
  if (!token || !verifySession(token)) throw redirect("/admin/login");
  return null;
};

const NAV_ITEMS = [
  { to: "/admin",          label: "📊 Dashboard",    exact: true },
  { to: "/admin/settings", label: "⚙️ AI & Settings", exact: false },
];

export default function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <div className="ap-layout">
      {/* Sidebar */}
      <aside className="ap-sidebar">
        <div className="ap-brand">
          <span>🎁</span>
          <div>
            <div className="ap-brand-name">Loyalty Admin</div>
            <div className="ap-brand-sub">Control Panel</div>
          </div>
        </div>

        <nav className="ap-nav">
          {NAV_ITEMS.map((item) => {
            const active = item.exact
              ? pathname === item.to
              : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`ap-nav-link${active ? " active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ap-sidebar-footer">
          <Form action="/admin/logout" method="post" style={{ margin: 0 }}>
            <button type="submit" className="ap-logout">
              🚪 Sign Out
            </button>
          </Form>
        </div>
      </aside>

      {/* Main */}
      <main className="ap-main">
        <Outlet />
      </main>
    </div>
  );
}
