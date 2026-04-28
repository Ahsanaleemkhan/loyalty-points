import prisma from "../db.server";

export interface VipTier {
  id: string;
  shop: string;
  name: string;
  minPoints: number;
  multiplier: number;
  color: string;
  perks: string[];
  sortOrder: number;
}

function parseTier(raw: { id: string; shop: string; name: string; minPoints: number; multiplier: number; color: string; perks: string; sortOrder: number }): VipTier {
  return {
    ...raw,
    perks: (() => { try { return JSON.parse(raw.perks) as string[]; } catch { return []; } })(),
  };
}

export async function getTiers(shop: string): Promise<VipTier[]> {
  const rows = await prisma.vipTier.findMany({ where: { shop }, orderBy: { sortOrder: "asc" } });
  return rows.map(parseTier);
}

export async function upsertTier(shop: string, data: Omit<VipTier, "id" | "shop">, id?: string) {
  const payload = { ...data, perks: JSON.stringify(data.perks), shop };
  if (id) {
    return parseTier(await prisma.vipTier.update({ where: { id }, data: payload }));
  }
  return parseTier(await prisma.vipTier.create({ data: payload }));
}

export async function deleteTier(id: string) {
  return prisma.vipTier.delete({ where: { id } });
}

/** Resolve which tier a customer is on and their multiplier based on lifetime points */
export function resolveCustomerTier(lifetimePoints: number, tiers: VipTier[]): VipTier | null {
  const sorted = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  return sorted.find((t) => lifetimePoints >= t.minPoints) ?? null;
}

/** Compute multiplied points for an amount */
export function applyTierMultiplier(basePoints: number, tier: VipTier | null): number {
  if (!tier) return basePoints;
  return Math.floor(basePoints * tier.multiplier);
}

/** Default tiers to seed for a new shop */
export const DEFAULT_TIERS: Omit<VipTier, "id" | "shop">[] = [
  { name: "Bronze", minPoints: 0,    multiplier: 1.0, color: "#cd7f32", perks: ["Earn 1x points on every purchase"], sortOrder: 0 },
  { name: "Silver", minPoints: 500,  multiplier: 1.5, color: "#6b7280", perks: ["Earn 1.5x points on every purchase", "Priority review on receipt submissions"], sortOrder: 1 },
  { name: "Gold",   minPoints: 2000, multiplier: 2.0, color: "#d97706", perks: ["Earn 2x points on every purchase", "Priority review", "Exclusive Gold member deals"], sortOrder: 2 },
];
