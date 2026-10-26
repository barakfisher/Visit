ALTER TABLE "BusinessInvitation" ADD COLUMN "revokedByIdentityId" TEXT REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "BusinessAccessEvent" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "membershipId" TEXT NOT NULL, "subjectIdentityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorIdentityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "role" "MembershipRole" NOT NULL, "action" TEXT NOT NULL CHECK ("action" IN ('JOINED','REVOKED','OWNER_GRANTED')),
  "referenceId" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId","membershipId","subjectIdentityId") REFERENCES "Membership"("businessId","id","identityId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BusinessAccessEvent_businessId_createdAt_idx" ON "BusinessAccessEvent"("businessId","createdAt");
CREATE FUNCTION visit_business_access_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'VISIT_ACCESS_AUDIT_IMMUTABLE' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER visit_business_access_audit_immutable BEFORE UPDATE ON "BusinessAccessEvent" FOR EACH ROW EXECUTE FUNCTION visit_business_access_audit_immutable();
