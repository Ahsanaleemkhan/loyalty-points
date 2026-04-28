import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import shopify from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Re-register webhooks on every admin load so the tunnel URL stays current
  // during development (Cloudflare tunnel URL changes on each restart).
  shopify.registerWebhooks({ session }).catch(() => {});

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

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
