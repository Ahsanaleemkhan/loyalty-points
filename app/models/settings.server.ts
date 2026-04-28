import prisma from "../db.server";

export interface Settings {
  id: string;
  shop: string;
  pointsPerAmount: number;
  amountPerPoints: number;
  minPurchaseAmount: number;
  pointsExpiryDays: number;
  isEnabled: boolean;
  currency: string;
  // Redemption
  redemptionEnabled: boolean;
  pointsPerDiscount: number;
  discountValue: number;
  minPointsRedeem: number;
  // VIP
  tiersEnabled: boolean;
  // Email
  emailEnabled: boolean;
  emailFromName: string;
}

export async function getSettings(shop: string): Promise<Settings> {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (settings) return settings;
  return prisma.appSettings.create({
    data: { shop },
  });
}

export async function updateSettings(
  shop: string,
  data: Partial<Omit<Settings, "id" | "shop">>,
) {
  return prisma.appSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

export function calculatePoints(
  amount: number,
  settings: Settings,
): number {
  if (!settings.isEnabled) return 0;
  if (amount < settings.minPurchaseAmount) return 0;
  const rate = settings.pointsPerAmount / settings.amountPerPoints;
  return Math.floor(amount * rate);
}
