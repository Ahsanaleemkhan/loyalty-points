import type { HeadersFunction } from "react-router";
import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

/** Layout wrapper for /app/customers and /app/customers/:id */
export default function CustomersLayout() {
  return <Outlet />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
