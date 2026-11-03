-- A business has no category until its owner chooses one. The old default 'General' was
-- never chosen by anyone, so existing rows that still hold it become NULL.
ALTER TABLE "Business" ALTER COLUMN "category" DROP NOT NULL, ALTER COLUMN "category" DROP DEFAULT;
UPDATE "Business" SET "category" = NULL WHERE "category" = 'General';
