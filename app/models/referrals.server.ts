import prisma from "../db.server";

function generateCode(email: string): string {
  const base = email.split("@")[0].replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}${rand}`;
}

export async function getOrCreateReferralCode(params: {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
}): Promise<string> {
  const existing = await prisma.referral.findFirst({
    where: { shop: params.shop, referrerId: params.customerId, status: "PENDING" },
  });
  if (existing) return existing.referralCode;

  let code = generateCode(params.customerEmail);
  // Ensure uniqueness
  let attempts = 0;
  while (await prisma.referral.findUnique({ where: { referralCode: code } })) {
    code = generateCode(params.customerEmail) + attempts++;
  }

  await prisma.referral.create({
    data: {
      shop: params.shop,
      referrerId: params.customerId,
      referrerEmail: params.customerEmail,
      referrerName: params.customerName || "",
      referralCode: code,
    },
  });

  return code;
}

export async function getReferrals(shop: string, referrerId?: string) {
  return prisma.referral.findMany({
    where: { shop, ...(referrerId ? { referrerId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function getReferralByCode(code: string) {
  return prisma.referral.findUnique({ where: { referralCode: code } });
}

export async function convertReferral(params: {
  referralCode: string;
  referredId: string;
  referredEmail: string;
}): Promise<{ referral: Awaited<ReturnType<typeof getReferralByCode>>; alreadyConverted: boolean }> {
  const referral = await getReferralByCode(params.referralCode);
  if (!referral) return { referral: null, alreadyConverted: false };
  if (referral.status === "CONVERTED") return { referral, alreadyConverted: true };

  const updated = await prisma.referral.update({
    where: { referralCode: params.referralCode },
    data: {
      referredId: params.referredId,
      referredEmail: params.referredEmail,
      status: "CONVERTED",
    },
  });
  return { referral: updated, alreadyConverted: false };
}

export async function getReferralStats(shop: string) {
  const [total, converted] = await Promise.all([
    prisma.referral.count({ where: { shop } }),
    prisma.referral.count({ where: { shop, status: "CONVERTED" } }),
  ]);
  const totalPointsResult = await prisma.referral.aggregate({
    where: { shop, status: "CONVERTED" },
    _sum: { pointsAwarded: true },
  });
  return {
    total,
    converted,
    pending: total - converted,
    totalPointsAwarded: totalPointsResult._sum.pointsAwarded ?? 0,
    conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
  };
}
