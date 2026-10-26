CREATE UNIQUE INDEX "Membership_businessId_id_identityId_key" ON "Membership"("businessId","id","identityId");
CREATE TABLE "BusinessInvitation" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "inviterIdentityId" TEXT NOT NULL, "inviterMembershipId" TEXT NOT NULL,
  "inviterRole" "MembershipRole" NOT NULL, "role" "MembershipRole" NOT NULL,
  "recipientChannel" TEXT NOT NULL CHECK ("recipientChannel" IN ('email','phone')),
  "recipientDigest" TEXT NOT NULL CHECK ("recipientDigest" ~ '^[0-9a-f]{64}$'), "recipientHint" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3), "acceptedAt" TIMESTAMPTZ(3), "acceptedByIdentityId" TEXT,
  CHECK ("role" IN ('MANAGER','STAFF') AND ("inviterRole" = 'OWNER' OR ("inviterRole" = 'MANAGER' AND "role" = 'STAFF'))),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '7 days'),
  CHECK (("acceptedAt" IS NULL) = ("acceptedByIdentityId" IS NULL)),
  CHECK (NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT NULL)),
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("inviterIdentityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("businessId","inviterMembershipId","inviterIdentityId") REFERENCES "Membership"("businessId","id","identityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("acceptedByIdentityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BusinessInvitation_businessId_createdAt_idx" ON "BusinessInvitation"("businessId","createdAt");
CREATE TABLE "BusinessOwnershipReview" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claimantIdentityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claimantSecurityVersion" INTEGER NOT NULL,
  "createdByIdentityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedByIdentityId" TEXT REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "caseReference" TEXT NOT NULL UNIQUE, "evidenceKind" TEXT NOT NULL CHECK ("evidenceKind" IN ('CURRENT_OWNER_CONSENT','REGISTRATION_RECORDS','PLATFORM_RECORDS')),
  "evidenceSummary" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
  "reason" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMPTZ(3),
  CHECK (("status" = 'PENDING' AND "reviewedByIdentityId" IS NULL AND "reviewedAt" IS NULL AND "reason" IS NULL) OR ("status" <> 'PENDING' AND "reviewedByIdentityId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length("reason") >= 5)),
  CHECK ("claimantIdentityId" <> "createdByIdentityId" AND ("reviewedByIdentityId" IS NULL OR "claimantIdentityId" <> "reviewedByIdentityId"))
);
CREATE INDEX "BusinessOwnershipReview_status_createdAt_idx" ON "BusinessOwnershipReview"("status","createdAt");
CREATE FUNCTION visit_ownership_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING' OR NEW."businessId" <> OLD."businessId" OR NEW."claimantIdentityId" <> OLD."claimantIdentityId" OR NEW."claimantSecurityVersion" <> OLD."claimantSecurityVersion" OR NEW."createdByIdentityId" <> OLD."createdByIdentityId" OR NEW."caseReference" <> OLD."caseReference" OR NEW."evidenceKind" <> OLD."evidenceKind" OR NEW."evidenceSummary" <> OLD."evidenceSummary" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'VISIT_OWNERSHIP_AUDIT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_ownership_review_immutable BEFORE UPDATE ON "BusinessOwnershipReview" FOR EACH ROW EXECUTE FUNCTION visit_ownership_review_immutable();
