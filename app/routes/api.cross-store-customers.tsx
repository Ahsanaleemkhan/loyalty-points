/**
 * API: Cross-store customer list using stored Shopify access tokens.
 * Used by the admin Store Sync page to show unified customers across all grouped stores.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCrossStoreCustomers, getGroupStoreStatus } from "../utils/crossStoreShopify.server";
import { getGroupShops } from "../models/storeSync.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "customers";

  if (action === "status") {
    const status = await getGroupStoreStatus(shop);
    return json({ status });
  }

  const groupShops = await getGroupShops(shop);
  if (groupShops.length <= 1) {
    return json({ customers: [], message: "Not in a group — join or create a store group first." });
  }

  const customers = await getCrossStoreCustomers(shop, 50);
  return json({ customers, storeCount: groupShops.length });
};
