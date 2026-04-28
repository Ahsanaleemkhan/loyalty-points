-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "pointsSpent" INTEGER NOT NULL,
    "discountValue" REAL NOT NULL,
    "discountCode" TEXT NOT NULL,
    "discountGid" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VipTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "multiplier" REAL NOT NULL DEFAULT 1.0,
    "color" TEXT NOT NULL DEFAULT '#008060',
    "perks" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referrerEmail" TEXT NOT NULL,
    "referrerName" TEXT NOT NULL DEFAULT '',
    "referralCode" TEXT NOT NULL,
    "referredId" TEXT,
    "referredEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EarningRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "multiplier" REAL NOT NULL DEFAULT 1.0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "pointsPerAmount" INTEGER NOT NULL DEFAULT 10,
    "amountPerPoints" REAL NOT NULL DEFAULT 100,
    "minPurchaseAmount" REAL NOT NULL DEFAULT 0,
    "pointsExpiryDays" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "redemptionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerDiscount" INTEGER NOT NULL DEFAULT 100,
    "discountValue" REAL NOT NULL DEFAULT 1,
    "minPointsRedeem" INTEGER NOT NULL DEFAULT 100,
    "tiersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailFromName" TEXT NOT NULL DEFAULT 'Loyalty Rewards',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("amountPerPoints", "createdAt", "currency", "id", "isEnabled", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "shop", "updatedAt") SELECT "amountPerPoints", "createdAt", "currency", "id", "isEnabled", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "shop", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Redemption_shop_customerId_idx" ON "Redemption"("shop", "customerId");

-- CreateIndex
CREATE INDEX "Redemption_shop_discountCode_idx" ON "Redemption"("shop", "discountCode");

-- CreateIndex
CREATE INDEX "VipTier_shop_idx" ON "VipTier"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referralCode_key" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "Referral_shop_referrerId_idx" ON "Referral"("shop", "referrerId");

-- CreateIndex
CREATE INDEX "Referral_referralCode_idx" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "EarningRule_shop_idx" ON "EarningRule"("shop");
