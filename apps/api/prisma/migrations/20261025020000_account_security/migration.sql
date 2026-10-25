ALTER TABLE "Identity" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("securityVersion" >= 0);
CREATE TABLE "AccountContactChallenge" (
  "id" TEXT PRIMARY KEY, "handleHash" TEXT NOT NULL UNIQUE, "identityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL REFERENCES "Session"("id") ON DELETE CASCADE, "securityVersion" INTEGER NOT NULL CHECK ("securityVersion" >= 0),
  "channel" TEXT NOT NULL CHECK ("channel" IN ('email','phone')), "destination" TEXT NOT NULL, "codeHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 5), "expiresAt" TIMESTAMPTZ NOT NULL,
  "deliveredAt" TIMESTAMPTZ, "consumedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AccountContactChallenge_identityId_consumedAt_idx" ON "AccountContactChallenge"("identityId","consumedAt");
CREATE INDEX "AccountContactChallenge_expiresAt_idx" ON "AccountContactChallenge"("expiresAt");
CREATE TABLE "IdentitySecurityEvent" (
  "id" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE CASCADE,
  "action" TEXT NOT NULL CHECK ("action" IN ('LINKED','REPLACED','REMOVED')), "method" TEXT NOT NULL CHECK ("method" IN ('email','phone','google')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IdentitySecurityEvent_identityId_createdAt_idx" ON "IdentitySecurityEvent"("identityId","createdAt");
CREATE TABLE "SecurityNotification" (
  "id" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL REFERENCES "Identity"("id") ON DELETE CASCADE,
  "eventId" TEXT NOT NULL REFERENCES "IdentitySecurityEvent"("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('email','phone')), "destination" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','SENDING','ACCEPTED','FAILED','BLOCKED')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0), "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMPTZ, "acceptedAt" TIMESTAMPTZ, "provider" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SecurityNotification_status_nextAttemptAt_idx" ON "SecurityNotification"("status","nextAttemptAt");
CREATE INDEX "SecurityNotification_identityId_createdAt_idx" ON "SecurityNotification"("identityId","createdAt");
CREATE FUNCTION visit_immutable_identity_security_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "Identity" WHERE id = OLD."identityId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Identity security events are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER identity_security_event_immutable BEFORE UPDATE OR DELETE ON "IdentitySecurityEvent" FOR EACH ROW EXECUTE FUNCTION visit_immutable_identity_security_event();
