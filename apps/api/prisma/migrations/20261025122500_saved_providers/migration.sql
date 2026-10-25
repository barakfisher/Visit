ALTER TABLE "Business" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "SavedProvider" (
  "id" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL REFERENCES "Identity"(id) ON DELETE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"(id) ON DELETE RESTRICT,
  "displayName" TEXT NOT NULL, "savedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "SavedProvider_identityId_businessId_key" ON "SavedProvider"("identityId", "businessId");
CREATE INDEX "SavedProvider_identityId_savedAt_id_idx" ON "SavedProvider"("identityId", "savedAt", id);
CREATE OR REPLACE FUNCTION visit_guard_booking_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('HELD', 'CONFIRMED') AND
     (TG_OP = 'INSERT' OR NEW.status = 'HELD' OR OLD.status <> 'CONFIRMED' OR OLD."businessId" IS DISTINCT FROM NEW."businessId") THEN
    PERFORM id FROM "Business" WHERE id = NEW."businessId" AND "approvalStatus" = 'APPROVED' AND "publishedAt" IS NOT NULL AND "deletedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_BUSINESS_UNPUBLISHED' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
