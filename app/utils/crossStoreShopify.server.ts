/**
 * Cross-store Shopify API utility.
 *
 * When a merchant groups multiple stores, each store's access token is stored
 * in the Session table by Shopify auth. This utility uses those tokens to
 * query Shopify's Admin API on any store in the group — no extra auth needed.
 */
import prisma from "../db.server";
import { getGroupShops } from "../models/storeSync.server";

interface ShopifyCustomer {
  id: string;          // GID format: gid://shopify/Customer/123
  email: string;
  firstName: string;
  lastName: string;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
}

interface CrossStoreCustomer extends ShopifyCustomer {
  fromShop: string;
  pointsBalance: number;
}

/**
 * Get the stored offline access token for a shop.
 * Returns null if the shop has no session (not installed).
 */
export async function getAccessToken(shop: string): Promise<string | null> {
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    select: { accessToken: true },
    orderBy: { expires: "desc" },
  });
  return session?.accessToken ?? null;
}

/**
 * Query Shopify Admin GraphQL API for a specific shop using its stored token.
 */
export async function shopifyAdminQuery<T = unknown>(
  shop: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T | null> {
  const token = await getAccessToken(shop);
  if (!token) {
    console.warn(`[crossStore] No access token for shop: ${shop}`);
    return null;
  }

  try {
    const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      console.warn(`[crossStore] Shopify API error for ${shop}: ${res.status}`);
      return null;
    }

    const json = await res.json() as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      console.warn(`[crossStore] GraphQL errors for ${shop}:`, json.errors);
    }
    return json.data ?? null;
  } catch (err) {
    console.error(`[crossStore] Fetch error for ${shop}:`, err);
    return null;
  }
}

/**
 * Look up a customer by email on a specific store using its access token.
 * Returns the customer's Shopify GID on that store, or null if not found.
 */
export async function findCustomerByEmailOnShop(
  shop: string,
  email: string,
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const data = await shopifyAdminQuery<{
    customers: { edges: { node: { id: string; firstName: string; lastName: string } }[] };
  }>(shop, `
    query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
          }
        }
      }
    }
  `, { query: `email:${email}` });

  return data?.customers?.edges?.[0]?.node ?? null;
}

/**
 * Get a page of customers from a specific store (for admin cross-store list).
 */
export async function getCustomersFromShop(
  shop: string,
  limit = 50,
  cursor?: string,
): Promise<{ customers: ShopifyCustomer[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await shopifyAdminQuery<{
    customers: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: {
        node: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
          numberOfOrders: string;
          amountSpent: { amount: string };
          createdAt: string;
        };
      }[];
    };
  }>(shop, `
    query GetCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            email
            firstName
            lastName
            numberOfOrders
            amountSpent { amount }
            createdAt
          }
        }
      }
    }
  `, { first: limit, after: cursor ?? null });

  if (!data?.customers) {
    return { customers: [], hasNextPage: false, endCursor: null };
  }

  return {
    customers: data.customers.edges.map((e) => ({
      id: e.node.id,
      email: e.node.email ?? "",
      firstName: e.node.firstName ?? "",
      lastName: e.node.lastName ?? "",
      ordersCount: parseInt(e.node.numberOfOrders ?? "0", 10),
      totalSpent: e.node.amountSpent?.amount ?? "0",
      createdAt: e.node.createdAt,
    })),
    hasNextPage: data.customers.pageInfo.hasNextPage,
    endCursor: data.customers.pageInfo.endCursor,
  };
}

/**
 * Fetch cross-store customer list for all stores in a group.
 * Merges by email — shows unified balance from our DB.
 */
export async function getCrossStoreCustomers(
  shop: string,
  limit = 30,
): Promise<CrossStoreCustomer[]> {
  const groupShops = await getGroupShops(shop);

  // Fetch customers from all stores in parallel
  const results = await Promise.allSettled(
    groupShops.map(async (s) => {
      const { customers } = await getCustomersFromShop(s, limit);
      return customers.map((c) => ({ ...c, fromShop: s }));
    }),
  );

  // Flatten and deduplicate by email (keep highest balance)
  const emailMap = new Map<string, CrossStoreCustomer>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const customer of result.value) {
      if (!customer.email) continue;
      if (!emailMap.has(customer.email)) {
        emailMap.set(customer.email, { ...customer, pointsBalance: 0 });
      }
    }
  }

  // Bulk-fetch points balances for all unique emails from our DB
  const emails = [...emailMap.keys()];
  if (emails.length === 0) return [];

  const balances = await prisma.pointsTransaction.groupBy({
    by: ["customerEmail"],
    where: {
      shop: { in: groupShops },
      customerEmail: { in: emails },
    },
    _sum: { points: true },
  });

  for (const b of balances) {
    const existing = emailMap.get(b.customerEmail);
    if (existing) {
      existing.pointsBalance = b._sum.points ?? 0;
    }
  }

  return [...emailMap.values()].sort((a, b) => b.pointsBalance - a.pointsBalance);
}

/**
 * Get all stores in a group with their connection status.
 */
export async function getGroupStoreStatus(shop: string): Promise<{
  shop: string;
  hasToken: boolean;
  isCurrentShop: boolean;
}[]> {
  const groupShops = await getGroupShops(shop);

  return Promise.all(
    groupShops.map(async (s) => ({
      shop: s,
      hasToken: !!(await getAccessToken(s)),
      isCurrentShop: s === shop,
    })),
  );
}
