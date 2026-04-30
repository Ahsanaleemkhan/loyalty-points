import type { HeadersFunction } from "react-router";
import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

/** Layout wrapper for /app/submissions and /app/submissions/:id */
export default function SubmissionsLayout() {
  return <Outlet />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
