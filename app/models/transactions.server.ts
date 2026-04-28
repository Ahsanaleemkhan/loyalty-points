import prisma from "../db.server";

export type TransactionType =
  | "EARNED_ONLINE"
  | "EARNED_PHYSICAL"
  | "EARNED_RULE"
  | "MANUAL_ADJUST"
  | "REDEEMED"
  | "EXPIRED";

export interface CreateTransactionInput {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  points: number;
  type: TransactionType;
  orderId?: string;
  submissionId?: string;
  note?: string;
}

export async function createTransaction(input: CreateTransactionInput) {
  return prisma.pointsTransaction.create({ data: input });
}

export async function getTransactions(shop: string, customerId?: string) {
  return prisma.pointsTransaction.findMany({
    where: { shop, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCustomerPointsBalance(
  shop: string,
  customerId: string,
): Promise<number> {
  const result = await prisma.pointsTransaction.aggregate({
    where: { shop, customerId },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
}

export async function getShopStats(shop: string) {
  const [totalPointsResult, totalTx, pendingSubmissions, monthlyPoints] =
    await Promise.all([
      prisma.pointsTransaction.aggregate({
        where: { shop },
        _sum: { points: true },
      }),
      prisma.pointsTransaction.count({ where: { shop } }),
      prisma.physicalSubmission.count({ where: { shop, status: "PENDING" } }),
      prisma.pointsTransaction.aggregate({
        where: {
          shop,
          createdAt: { gte: new Date(new Date().setDate(1)) },
        },
        _sum: { points: true },
      }),
    ]);

  const uniqueCustomers = await prisma.pointsTransaction.groupBy({
    by: ["customerId"],
    where: { shop },
  });

  return {
    totalPointsAwarded: totalPointsResult._sum.points ?? 0,
    totalTransactions: totalTx,
    pendingSubmissions,
    pointsThisMonth: monthlyPoints._sum.points ?? 0,
    uniqueCustomers: uniqueCustomers.length,
  };
}
