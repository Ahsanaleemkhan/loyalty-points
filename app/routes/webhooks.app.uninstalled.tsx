import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[${topic}] Uninstall webhook received for ${shop}`);

  // ── 1. Delete Shopify session (required — app can't use API without session) ──
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // ── 2. Soft-delete: stamp uninstalledAt so we know when 90-day grace ends ──
  await db.appSettings.upsert({
    where:  { shop },
    update: { uninstalledAt: new Date() },
    create: { shop, uninstalledAt: new Date() },
  }).catch((e) => console.warn("[uninstall] Could not stamp uninstalledAt:", e?.message));

  // ── 3. Hard-delete data for shops uninstalled > 90 days ago (lazy cleanup) ──
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  try {
    const staleShops = await db.appSettings.findMany({
      where: { uninstalledAt: { lt: cutoff } },
      select: { shop: true },
    });

    for (const { shop: staleShop } of staleShops) {
      console.log(`[uninstall] Purging stale data for ${staleShop} (uninstalled > 90 days ago)`);
      await db.$transaction([
        db.pointsTransaction.deleteMany({ where: { shop: staleShop } }),
        db.redemption.deleteMany({ where: { shop: staleShop } }),
        db.physicalSubmission.deleteMany({ where: { shop: staleShop } }),
        db.referral.deleteMany({ where: { shop: staleShop } }),
        db.vipTier.deleteMany({ where: { shop: staleShop } }),
        db.earningRule.deleteMany({ where: { shop: staleShop } }),
        db.session.deleteMany({ where: { shop: staleShop } }),
        db.appSettings.delete({ where: { shop: staleShop } }),
      ]);
      console.log(`[uninstall] ✓ Purged all data for ${staleShop}`);
    }
  } catch (e: any) {
    // Non-fatal — cleanup will retry on the next uninstall event
    console.warn("[uninstall] Stale cleanup error:", e?.message);
  }

  return new Response();
};
