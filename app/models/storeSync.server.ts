import prisma from "../db.server";

/** Return all shops in the same group as `shop` (including itself), or just [shop] if not in a group. */
export async function getGroupShops(shop: string): Promise<string[]> {
  // Check if shop owns a group
  const owned = await prisma.storeGroup.findUnique({
    where: { ownerShop: shop },
    include: { members: true },
  });
  if (owned) {
    return [shop, ...owned.members.map((m) => m.shop)];
  }

  // Check if shop is a member of someone else's group
  const membership = await prisma.storeGroupMember.findUnique({
    where: { shop },
    include: { group: { include: { members: true } } },
  });
  if (membership) {
    const { group } = membership;
    return [group.ownerShop, ...group.members.map((m) => m.shop)];
  }

  return [shop];
}

/** Get the group a shop belongs to (owner or member), null if none. */
export async function getShopGroup(shop: string) {
  const owned = await prisma.storeGroup.findUnique({
    where: { ownerShop: shop },
    include: { members: true },
  });
  if (owned) return { group: owned, role: "owner" as const };

  const membership = await prisma.storeGroupMember.findUnique({
    where: { shop },
    include: { group: { include: { members: true } } },
  });
  if (membership) return { group: membership.group, role: "member" as const };

  return null;
}

/** Create a new store group owned by `shop`. */
export async function createStoreGroup(shop: string, name: string) {
  // Can't own two groups
  return prisma.storeGroup.upsert({
    where: { ownerShop: shop },
    update: { name },
    create: { ownerShop: shop, name },
  });
}

/** Join a group using its linkCode. Returns the group or throws. */
export async function joinStoreGroup(shop: string, linkCode: string) {
  const group = await prisma.storeGroup.findUnique({ where: { linkCode } });
  if (!group) throw new Error("Invalid link code.");
  if (group.ownerShop === shop) throw new Error("You own this group.");

  // Leave any existing group first
  await leaveStoreGroup(shop);

  return prisma.storeGroupMember.create({
    data: { shop, groupId: group.id },
  });
}

/** Leave / disband group. Owner disbands (removes all members). Member just leaves. */
export async function leaveStoreGroup(shop: string) {
  const membership = await prisma.storeGroupMember.findUnique({ where: { shop } });
  if (membership) {
    await prisma.storeGroupMember.delete({ where: { shop } });
    return;
  }
  // If owner, disband
  const owned = await prisma.storeGroup.findUnique({ where: { ownerShop: shop } });
  if (owned) {
    await prisma.storeGroup.delete({ where: { ownerShop: shop } });
  }
}

/** Remove a specific member from owner's group. */
export async function removeMember(ownerShop: string, memberShop: string) {
  const group = await prisma.storeGroup.findUnique({ where: { ownerShop } });
  if (!group) throw new Error("No group found.");
  await prisma.storeGroupMember.deleteMany({
    where: { shop: memberShop, groupId: group.id },
  });
}

/**
 * Get cross-store balance for a customer identified by email.
 * Sums all positive transactions across all shops in the group.
 */
export async function getCrossStoreBalance(shop: string, customerEmail: string): Promise<number> {
  const shops = await getGroupShops(shop);
  const result = await prisma.pointsTransaction.aggregate({
    where: { shop: { in: shops }, customerEmail },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
}
