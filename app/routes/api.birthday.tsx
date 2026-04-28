/**
 * POST /api/birthday
 * Saves a customer's birthday as a Shopify metafield (loyalty.birthday = "MM-DD").
 * Called from the storefront widget.
 */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import shopify from "../shopify.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

export async function loader() {
  return new Response(null, { headers: CORS });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await request.json() as { shop?: string; customerId?: string; birthday?: string };
    const { shop, customerId, birthday } = body;

    if (!shop || !customerId || !birthday) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Validate birthday is a valid MM-DD
    const match = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$|^(\d{2})-(\d{2})$/);
    if (!match) return json({ error: "Invalid birthday format" }, 400);

    // Extract MM-DD (store only month-day, not year, for privacy)
    const mmdd = birthday.length === 10
      ? birthday.slice(5) // "YYYY-MM-DD" → "MM-DD"
      : birthday;         // already "MM-DD"

    // Verify shop exists
    const session = await prisma.session.findFirst({ where: { shop, isOnline: false } });
    if (!session) return json({ error: "Unknown shop" }, 403);

    const { admin } = await shopify.unauthenticated.admin(shop);

    const gid = customerId.startsWith("gid://") ? customerId : `gid://shopify/Customer/${customerId}`;

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
          metafields: [{
            ownerId: gid,
            namespace: "loyalty",
            key: "birthday",
            value: mmdd,
            type: "single_line_text_field",
          }],
        },
      }
    );

    return json({ success: true, birthday: mmdd });
  } catch (err) {
    console.error("Birthday save error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
