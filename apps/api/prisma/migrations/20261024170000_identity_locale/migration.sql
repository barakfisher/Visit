ALTER TABLE "Identity" ADD COLUMN "preferredLocale" TEXT;
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_preferredLocale_check"
  CHECK ("preferredLocale" IS NULL OR "preferredLocale" IN ('he', 'en'));
