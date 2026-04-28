-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "pointsPerAmount" INTEGER NOT NULL DEFAULT 10,
    "amountPerPoints" REAL NOT NULL DEFAULT 100,
    "minPurchaseAmount" REAL NOT NULL DEFAULT 0,
    "pointsExpiryDays" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "points" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "submissionId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PhysicalSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "receiptData" TEXT NOT NULL,
    "receiptName" TEXT NOT NULL,
    "receiptType" TEXT NOT NULL,
    "receiptSize" INTEGER NOT NULL,
    "purchaseAmount" REAL NOT NULL,
    "purchaseDate" TEXT NOT NULL,
    "storeLocation" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT NOT NULL DEFAULT '',
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");

-- CreateIndex
CREATE INDEX "PointsTransaction_shop_customerId_idx" ON "PointsTransaction"("shop", "customerId");

-- CreateIndex
CREATE INDEX "PointsTransaction_shop_idx" ON "PointsTransaction"("shop");

-- CreateIndex
CREATE INDEX "PhysicalSubmission_shop_status_idx" ON "PhysicalSubmission"("shop", "status");

-- CreateIndex
CREATE INDEX "PhysicalSubmission_shop_customerId_idx" ON "PhysicalSubmission"("shop", "customerId");
