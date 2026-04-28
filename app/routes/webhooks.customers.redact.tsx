/**
 * GDPR compliance webhook — customers/redact
 * Shopify sends this 10 days after a customer requests deletion (or 60 days
 * after uninstall, for customers who never made an order).
 *
 * We must permanently delete all personal data we hold for this customer.
 * Required for ALL apps listed on the Shopify App Store.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

  try {
    const { customer } = payload as {
      customer: { id: number; email: string };
    };

    if (!customer?.id) {
      return new Response("OK", { status: 200 });
    }

    const customerId = `gid://shopify/Customer/${customer.id}`;
    const customerEmail = customer.email;

    // Hard-delete all personal data we hold for this customer.
    // We match by both customerId GID and email to catch any legacy records.
    await Promise.all([
      prisma.pointsTransaction.deleteMany({
        where: { shop, OR: [{ customerId }, { customerEmail }] },
      }),
      prisma.physicalSubmission.deleteMany({
        where: { shop, OR: [{ customerId }, { customerEmail }] },
      }),
      prisma.referral.deleteMany({
        where: {
          shop,
          OR: [
            { referrerId: customerId },
            { referrerEmail: customerEmail },
            { referredId: customerId },
            { referredEmail: customerEmail },
          ],
        },
      }),
      prisma.redemption.deleteMany({
        where: { shop, OR: [{ customerId }, { customerEmail }] },
      }),
    ]);

    console.log(
      `[GDPR] Redacted all data for customer ${customerEmail} (${customerId}) from shop ${shop}`
    );
  } catch (err) {
    console.error("[GDPR] customers/redact error:", err);
  }

  return new Response("OK", { status: 200 });
};
