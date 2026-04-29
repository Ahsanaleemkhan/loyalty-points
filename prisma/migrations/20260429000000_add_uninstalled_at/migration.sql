-- Add uninstalledAt to AppSettings for soft-delete on uninstall
-- Nullable: set when merchant uninstalls, cleared when they reinstall
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMP(3);
