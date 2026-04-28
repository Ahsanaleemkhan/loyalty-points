import { createTransaction, getCustomerPointsBalance } from "./transactions.server";
import type { TransactionType } from "./transactions.server";

interface AdminGraphql {
  (query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

export async function syncPointsToMetafield(
  customerId: string,
  points: number,
  admin: { graphql: AdminGraphql },
) {
  // customerId is like "gid://shopify/Customer/123"
  const numericId = customerId.replace("gid://shopify/Customer/", "");
  const gid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  await admin.graphql(
    `#graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: gid,
            namespace: "loyalty",
            key: "points_balance",
            value: String(points),
            type: "number_integer",
          },
        ],
      },
    },
  );
}

export async function awardPoints(params: {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  points: number;
  type: TransactionType;
  orderId?: string;
  submissionId?: string;
  note?: string;
  admin: { graphql: AdminGraphql };
}) {
  const { admin, ...txData } = params;
  // Always save the transaction to our DB first — this is the source of truth.
  await createTransaction(txData);
  const newBalance = await getCustomerPointsBalance(params.shop, params.customerId);
  // Syncing to Shopify metafield is best-effort — don't let it block point awarding.
  syncPointsToMetafield(params.customerId, newBalance, admin).catch((e) =>
    console.warn("[points] metafield sync failed (non-fatal):", e?.message)
  );
  return newBalance;
}

export async function adjustPoints(params: {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  pointsDelta: number;
  note: string;
  admin: { graphql: AdminGraphql };
}) {
  const { admin, pointsDelta, ...rest } = params;
  await createTransaction({
    ...rest,
    points: pointsDelta,
    type: "MANUAL_ADJUST",
  });
  const newBalance = await getCustomerPointsBalance(params.shop, params.customerId);
  syncPointsToMetafield(params.customerId, newBalance, admin).catch((e) =>
    console.warn("[points] metafield sync failed (non-fatal):", e?.message)
  );
  return newBalance;
}
