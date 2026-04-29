import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import shopify from "../shopify.server";
import { AdminChatBubble } from "../components/AdminChatBubble";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Cache the freshest admin access token in AppSettings so storefront APIs
  // (like /api/redeem) can use it instead of the install-time offline token,
  // which may be a deprecated non-expiring shpat_ token Shopify rejects.
  if (session.accessToken) {
    const expiresAt = session.expires
      ? new Date(session.expires)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // assume 24h if not provided
    prisma.appSettings
      .upsert({
        where: { shop: session.shop },
        update: {
          adminAccessToken: session.accessToken,
          adminTokenExpires: expiresAt,
        },
        create: {
          shop: session.shop,
          adminAccessToken: session.accessToken,
          adminTokenExpires: expiresAt,
        },
      })
      .catch((e) => console.warn("[app loader] failed to cache admin token:", e?.message));
  }

  // Re-register webhooks on every admin load so the tunnel URL stays current
  // during development (Cloudflare tunnel URL changes on each restart).
  shopify.registerWebhooks({ session }).catch(() => {});

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop };
};

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/customers">Customers</s-link>
        <s-link href="/app/submissions">Submissions</s-link>
        <s-link href="/app/tiers">Program</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/widget-builder">Tools</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
      <AdminChatBubble shop={shop} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
