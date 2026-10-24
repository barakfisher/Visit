ALTER TABLE "Session" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
ALTER TABLE "Session" ADD COLUMN "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Legacy tokens already revoked all sessions for an identity on replay. Preserve
-- that conservative boundary while giving each subsequent login its own family.
UPDATE "Session" SET "familyId" = "identityId", "authenticatedAt" = "createdAt";
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
