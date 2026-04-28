import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData } from "react-router";
import {
  checkCredentials,
  COOKIE_NAME,
  COOKIE_OPTS,
  parseAdminCookie,
  signSession,
  verifySession,
} from "../utils/admin-auth.server";
import adminPortalCss from "../styles/admin-portal.css?url";

export const links = () => [{ rel: "stylesheet", href: adminPortalCss }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = parseAdminCookie(request.headers.get("Cookie"));
  if (token && verifySession(token)) throw redirect("/admin");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");

  if (!checkCredentials(username, password)) {
    return { error: "Invalid username or password." };
  }

  const token = signSession(username);
  throw redirect("/admin", {
    headers: { "Set-Cookie": `${COOKIE_NAME}=${token}; ${COOKIE_OPTS}` },
  });
};

export default function AdminLogin() {
  const data = useActionData<typeof action>();

  return (
    <div className="ap-login-wrap">
      <div className="ap-login-card">
        <div className="ap-login-logo">
          <div className="ap-login-icon">🛡️</div>
          <div className="ap-login-title">Loyalty Admin</div>
          <div className="ap-login-sub">Platform Control Panel</div>
        </div>

        {data?.error && <div className="ap-error">{data.error}</div>}

        <Form method="post">
          <div className="ap-field">
            <label htmlFor="username">Username</label>
            <input id="username" name="username" type="text" autoComplete="username" required placeholder="admin" />
          </div>
          <div className="ap-field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
          </div>
          <button className="ap-btn ap-btn-full" type="submit">
            Sign In →
          </button>
        </Form>
      </div>
    </div>
  );
}
