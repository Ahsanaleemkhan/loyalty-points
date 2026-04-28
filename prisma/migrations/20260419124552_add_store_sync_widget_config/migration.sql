-- CreateTable
CREATE TABLE "StoreGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerShop" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Store Group',
    "linkCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StoreGroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StoreGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "widgetTitle" TEXT NOT NULL DEFAULT 'My Rewards',
    "widgetColor" TEXT NOT NULL DEFAULT '#008060',
    "widgetPosition" TEXT NOT NULL DEFAULT 'bottom-right',
    "widgetBgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("amountPerPoints", "createdAt", "currency", "discountValue", "emailEnabled", "emailFromName", "id", "isEnabled", "minPointsRedeem", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "pointsPerDiscount", "redemptionEnabled", "shop", "tiersEnabled", "updatedAt") SELECT "amountPerPoints", "createdAt", "currency", "discountValue", "emailEnabled", "emailFromName", "id", "isEnabled", "minPointsRedeem", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "pointsPerDiscount", "redemptionEnabled", "shop", "tiersEnabled", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "StoreGroup_ownerShop_key" ON "StoreGroup"("ownerShop");

-- CreateIndex
CREATE UNIQUE INDEX "StoreGroup_linkCode_key" ON "StoreGroup"("linkCode");

-- CreateIndex
CREATE UNIQUE INDEX "StoreGroupMember_shop_key" ON "StoreGroupMember"("shop");
