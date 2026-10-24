ALTER TABLE "Session" ADD COLUMN "refreshExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '30 days');
-- Preserve the absolute expiry of pre-existing credentials during migration.
UPDATE "Session" SET "refreshExpiresAt" = "expiresAt";
ALTER TABLE "Session" ADD CONSTRAINT "Session_access_before_refresh_expiry" CHECK ("expiresAt" <= "refreshExpiresAt");
