import prisma from "../db.server";

export interface CreateSubmissionInput {
  shop: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  receiptData: string;
  receiptName: string;
  receiptType: string;
  receiptSize: number;
  purchaseAmount: number;
  purchaseDate: string;
  storeLocation?: string;
  notes?: string;
}

export async function createSubmission(input: CreateSubmissionInput) {
  return prisma.physicalSubmission.create({ data: input });
}

export async function getSubmissions(shop: string, status?: string) {
  return prisma.physicalSubmission.findMany({
    where: { shop, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSubmission(id: string) {
  return prisma.physicalSubmission.findUnique({ where: { id } });
}

export async function approveSubmission(
  id: string,
  pointsAwarded: number,
  adminNotes: string,
) {
  return prisma.physicalSubmission.update({
    where: { id },
    data: { status: "APPROVED", pointsAwarded, adminNotes, updatedAt: new Date() },
  });
}

export async function rejectSubmission(id: string, adminNotes: string) {
  return prisma.physicalSubmission.update({
    where: { id },
    data: { status: "REJECTED", adminNotes, updatedAt: new Date() },
  });
}

export async function getCustomerSubmissions(shop: string, customerId: string) {
  return prisma.physicalSubmission.findMany({
    where: { shop, customerId },
    orderBy: { createdAt: "desc" },
  });
}
