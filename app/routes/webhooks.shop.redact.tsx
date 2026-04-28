/**
 * GDPR compliance webhook — shop/redact
 * Shopify sends this 48 hours after a shop uninstalls the app (and 60 days
 * after the last customer data request window closes).
 *
 * We must permanently delete ALL data associated with the shop.
 * Required for ALL apps listed on the Shopify App Store.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

  try {
    // Delete all shop data in dependency order (no FK constraints in SQLite,
    // but doing it in a logical order is good practice).
    await Promise.all([
      prisma.pointsTransaction.deleteMany({ where: { shop } }),
      prisma.physicalSubmission.deleteMany({ where: { shop } }),
      prisma.referral.deleteMany({ where: { shop } }),
      prisma.redemption.deleteMany({ where: { shop } }),
      prisma.vipTier.deleteMany({ where: { shop } }),
      prisma.earningRule.deleteMany({ where: { shop } }),
      prisma.appSettings.deleteMany({ where: { shop } }),
    ]);

    // Remove store group membership
    await prisma.storeGroupMember.deleteMany({ where: { shop } });

    // If this shop owns a group, dissolve it (members lose sync)
    const ownedGroup = await prisma.storeGroup.findUnique({
      where: { ownerShop: shop },
    });
    if (ownedGroup) {
      await prisma.storeGroup.delete({ where: { ownerShop: shop } });
    }

    // Remove sessions
    await prisma.session.deleteMany({ where: { shop } });

    console.log(`[GDPR] Fully redacted all data for shop ${shop}`);
  } catch (err) {
    console.error("[GDPR] shop/redact error:", err);
  }

  return new Response("OK", { status: 200 });
};
