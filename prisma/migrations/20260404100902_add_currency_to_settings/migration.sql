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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("amountPerPoints", "createdAt", "id", "isEnabled", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "shop", "updatedAt") SELECT "amountPerPoints", "createdAt", "id", "isEnabled", "minPurchaseAmount", "pointsExpiryDays", "pointsPerAmount", "shop", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
